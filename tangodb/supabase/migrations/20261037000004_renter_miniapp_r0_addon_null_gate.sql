-- R0 follow-up: renter JWT has no auth_organization_id(); NULL = p_org must not skip the gate.

BEGIN;

CREATE OR REPLACE FUNCTION renter_miniapp_addon_is_active(p_org uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_jwt jsonb;
  v_today date;
  v_renter_org uuid;
  v_actor text;
  v_uid uuid;
  v_visible boolean;
BEGIN
  IF p_org IS NULL THEN
    RETURN false;
  END IF;

  BEGIN
    v_jwt := COALESCE(
      auth.jwt(),
      NULLIF(current_setting('request.jwt.claims', true), '')::jsonb,
      '{}'::jsonb
    );
  EXCEPTION WHEN invalid_text_representation THEN
    v_jwt := '{}'::jsonb;
  END;

  v_uid := auth.uid();
  v_actor := COALESCE(v_jwt -> 'app_metadata' ->> 'actor', '');

  BEGIN
    v_renter_org := NULLIF(v_jwt -> 'app_metadata' ->> 'organization_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_renter_org := NULL;
  END;

  IF v_uid IS NOT NULL OR v_actor = 'renter' THEN
    v_visible :=
      auth_organization_id() = p_org
      OR (v_actor = 'renter' AND v_renter_org = p_org);

    IF v_visible IS NOT TRUE THEN
      RETURN false;
    END IF;
  END IF;

  v_today := _org_local_date(p_org);

  RETURN EXISTS (
    SELECT 1
    FROM organization_addons a
    WHERE a.organization_id = p_org
      AND a.addon_code = 'renter_miniapp'
      AND a.status = 'active'
      AND a.period_start <= v_today
      AND a.period_end >= v_today
  );
END;
$$;

REVOKE ALL ON FUNCTION renter_miniapp_addon_is_active(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION renter_miniapp_addon_is_active(uuid) TO authenticated, service_role;

COMMIT;
