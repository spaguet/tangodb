-- Module gate Этап 1: finance_basic in onboarding default modules JSONB.

CREATE OR REPLACE FUNCTION complete_organization_onboarding(
  p_organization_id uuid,
  p_name text,
  p_org_preset text DEFAULT 'dance_school',
  p_locale text DEFAULT 'ru-RU',
  p_currency_code text DEFAULT 'RUB',
  p_modules jsonb DEFAULT NULL,
  p_pair_cycle_enabled boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_role text;
  v_trimmed_name text;
  v_preset text;
  v_locale text;
  v_currency text;
  v_modules jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'organization_id required' USING ERRCODE = '22023';
  END IF;

  v_trimmed_name := nullif(trim(p_name), '');
  IF v_trimmed_name IS NULL THEN
    RAISE EXCEPTION 'organization name required' USING ERRCODE = '22023';
  END IF;

  v_role := member_role(v_user_id, p_organization_id);
  IF v_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'only owner can complete onboarding' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM organizations o
    WHERE o.id = p_organization_id
      AND o.name IN ('Demo Organization', 'Organization')
      AND o.status IN ('demo_active', 'licensed')
  ) THEN
    RAISE EXCEPTION 'onboarding not required' USING ERRCODE = '22023';
  END IF;

  v_preset := coalesce(nullif(trim(p_org_preset), ''), 'dance_school');
  v_locale := coalesce(nullif(trim(p_locale), ''), 'ru-RU');
  v_currency := upper(coalesce(nullif(trim(p_currency_code), ''), 'RUB'));

  IF v_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'invalid currency_code' USING ERRCODE = '22023';
  END IF;

  v_modules := coalesce(
    p_modules,
    '{
      "group_subscriptions": true,
      "personal_lessons": true,
      "pair_subscriptions": true,
      "trio_lessons": true,
      "multi_discipline": true,
      "locations": true,
      "finance_basic": true
    }'::jsonb
  );

  IF jsonb_typeof(v_modules) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid modules' USING ERRCODE = '22023';
  END IF;

  UPDATE organizations
  SET name = v_trimmed_name
  WHERE id = p_organization_id;

  INSERT INTO organization_settings (
    organization_id,
    org_preset,
    locale,
    currency_code,
    modules,
    pair_cycle_enabled,
    branding_name,
    updated_at
  )
  VALUES (
    p_organization_id,
    v_preset,
    v_locale,
    v_currency,
    v_modules,
    coalesce(p_pair_cycle_enabled, true),
    v_trimmed_name,
    now()
  )
  ON CONFLICT (organization_id) DO UPDATE
    SET org_preset = EXCLUDED.org_preset,
        locale = EXCLUDED.locale,
        currency_code = EXCLUDED.currency_code,
        modules = EXCLUDED.modules,
        pair_cycle_enabled = EXCLUDED.pair_cycle_enabled,
        branding_name = EXCLUDED.branding_name,
        updated_at = EXCLUDED.updated_at;

  RETURN jsonb_build_object('ok', true, 'organization_id', p_organization_id);
END;
$$;

REVOKE ALL ON FUNCTION complete_organization_onboarding(
  uuid, text, text, text, text, jsonb, boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION complete_organization_onboarding(
  uuid, text, text, text, text, jsonb, boolean
) TO authenticated;
