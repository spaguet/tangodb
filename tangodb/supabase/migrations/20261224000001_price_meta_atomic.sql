-- P05 / M2: atomic price metadata + junction tables (create + update)

BEGIN;

CREATE OR REPLACE FUNCTION public._price_meta_manage_guard(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF auth.uid() IS NULL OR auth_organization_id() IS NULL THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF auth_organization_id() IS DISTINCT FROM p_org_id THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF NOT organization_allows_writes(p_org_id) THEN
    RAISE EXCEPTION 'read_only';
  END IF;

  IF NOT can_manage_prices() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._replace_price_disciplines(
  p_org_id uuid,
  p_price_id uuid,
  p_discipline_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_discipline_id uuid;
BEGIN
  DELETE FROM price_disciplines
  WHERE organization_id = p_org_id
    AND price_id = p_price_id;

  IF p_discipline_ids IS NULL OR cardinality(p_discipline_ids) = 0 THEN
    RETURN;
  END IF;

  FOREACH v_discipline_id IN ARRAY p_discipline_ids LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM disciplines d
      WHERE d.organization_id = p_org_id
        AND d.id = v_discipline_id
    ) THEN
      RAISE EXCEPTION 'invalid_discipline';
    END IF;
  END LOOP;

  INSERT INTO price_disciplines (organization_id, price_id, discipline_id)
  SELECT p_org_id, p_price_id, unnest(p_discipline_ids);
END;
$$;

CREATE OR REPLACE FUNCTION public._replace_price_teacher_members(
  p_org_id uuid,
  p_price_id uuid,
  p_member_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id uuid;
BEGIN
  DELETE FROM price_teacher_members
  WHERE organization_id = p_org_id
    AND price_id = p_price_id;

  IF p_member_ids IS NULL OR cardinality(p_member_ids) = 0 THEN
    RETURN;
  END IF;

  FOREACH v_member_id IN ARRAY p_member_ids LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM organization_members om
      WHERE om.organization_id = p_org_id
        AND om.id = v_member_id
    ) THEN
      RAISE EXCEPTION 'invalid_teacher_member';
    END IF;
  END LOOP;

  INSERT INTO price_teacher_members (organization_id, price_id, member_id)
  SELECT p_org_id, p_price_id, unnest(p_member_ids);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_price_meta(
  p_price_id uuid,
  p_label text,
  p_description text,
  p_set_location boolean,
  p_location_id uuid,
  p_set_duration boolean,
  p_duration_minutes integer,
  p_sync_disciplines boolean,
  p_discipline_ids uuid[],
  p_sync_teachers boolean,
  p_teacher_member_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid;
  v_legacy_discipline_id uuid;
BEGIN
  SELECT p.organization_id
  INTO v_org_id
  FROM prices p
  WHERE p.id = p_price_id;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  PERFORM public._price_meta_manage_guard(v_org_id);

  v_legacy_discipline_id := NULL;
  IF p_sync_disciplines THEN
    IF p_discipline_ids IS NOT NULL AND cardinality(p_discipline_ids) = 1 THEN
      v_legacy_discipline_id := p_discipline_ids[1];
    END IF;
  END IF;

  UPDATE prices
  SET
    label = btrim(p_label),
    description = btrim(p_description),
    location_id = CASE
      WHEN p_set_location THEN p_location_id
      ELSE location_id
    END,
    duration_minutes = CASE
      WHEN p_set_duration THEN p_duration_minutes
      ELSE duration_minutes
    END,
    discipline_id = CASE
      WHEN p_sync_disciplines THEN v_legacy_discipline_id
      ELSE discipline_id
    END
  WHERE id = p_price_id
    AND organization_id = v_org_id;

  IF p_sync_disciplines THEN
    PERFORM public._replace_price_disciplines(
      v_org_id,
      p_price_id,
      COALESCE(p_discipline_ids, ARRAY[]::uuid[])
    );
  END IF;

  IF p_sync_teachers THEN
    PERFORM public._replace_price_teacher_members(
      v_org_id,
      p_price_id,
      COALESCE(p_teacher_member_ids, ARRAY[]::uuid[])
    );
  END IF;

  RETURN jsonb_build_object('success', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_price_with_relations(
  p_type text,
  p_lessons integer,
  p_price numeric,
  p_label text,
  p_description text,
  p_category text,
  p_location_id uuid,
  p_billing_model text,
  p_duration_minutes integer,
  p_discipline_ids uuid[],
  p_teacher_member_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_price_id uuid;
  v_row prices%ROWTYPE;
  v_legacy_discipline_id uuid;
BEGIN
  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_org');
  END IF;

  PERFORM public._price_meta_manage_guard(v_org_id);

  v_legacy_discipline_id := NULL;
  IF p_discipline_ids IS NOT NULL AND cardinality(p_discipline_ids) = 1 THEN
    v_legacy_discipline_id := p_discipline_ids[1];
  END IF;

  INSERT INTO prices (
    organization_id,
    type,
    lessons,
    price,
    label,
    description,
    category,
    location_id,
    discipline_id,
    billing_model,
    duration_minutes
  )
  VALUES (
    v_org_id,
    btrim(p_type),
    p_lessons,
    p_price,
    btrim(p_label),
    btrim(p_description),
    p_category,
    p_location_id,
    v_legacy_discipline_id,
    COALESCE(p_billing_model, 'lesson_count'),
    CASE
      WHEN p_duration_minutes IS NOT NULL AND p_duration_minutes > 0 THEN p_duration_minutes
      ELSE NULL
    END
  )
  RETURNING * INTO v_row;

  v_price_id := v_row.id;

  IF p_discipline_ids IS NOT NULL AND cardinality(p_discipline_ids) > 0 THEN
    PERFORM public._replace_price_disciplines(v_org_id, v_price_id, p_discipline_ids);
  END IF;

  IF p_teacher_member_ids IS NOT NULL AND cardinality(p_teacher_member_ids) > 0 THEN
    PERFORM public._replace_price_teacher_members(v_org_id, v_price_id, p_teacher_member_ids);
  END IF;

  RETURN jsonb_build_object(
    'success',
    true,
    'price',
    to_jsonb(v_row)
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public._price_meta_manage_guard(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._replace_price_disciplines(uuid, uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._replace_price_teacher_members(uuid, uuid, uuid[]) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.update_price_meta(
  uuid,
  text,
  text,
  boolean,
  uuid,
  boolean,
  integer,
  boolean,
  uuid[],
  boolean,
  uuid[]
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.create_price_with_relations(
  text,
  integer,
  numeric,
  text,
  text,
  text,
  uuid,
  text,
  integer,
  uuid[],
  uuid[]
) TO authenticated;

COMMIT;
