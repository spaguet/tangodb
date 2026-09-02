-- Temporary: Mini App module is bundled with paid CRM access (lifetime or monthly CRM
-- subscription). Demo (30 days) stays fail-closed. Separate add-on payment is paused;
-- organization_addons is kept for a later paid-module restore and is not the gate.

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

  RETURN EXISTS (
    SELECT 1
    FROM organizations o
    WHERE o.id = p_org
      AND NOT o.schema_version_locked
      AND o.status = 'licensed'
      AND (
        organization_has_lifetime_license(o.id)
        OR organization_has_active_subscription(o.id)
      )
  );
END;
$$;

REVOKE ALL ON FUNCTION renter_miniapp_addon_is_active(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION renter_miniapp_addon_is_active(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION renter_miniapp_addon_is_active(uuid) IS
  'Mini App bundled with paid CRM: licensed + (lifetime OR active monthly CRM subscription). Demo / paused schema / no paid access = false. JWT callers only see own org (member or renter app_metadata). organization_addons is not the gate while add-on billing is paused.';

COMMIT;
