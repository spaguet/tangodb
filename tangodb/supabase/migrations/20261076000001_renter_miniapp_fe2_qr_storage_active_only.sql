-- FE2 / P1-24: renter Storage SELECT only for active QR assets; staff unchanged.

CREATE OR REPLACE FUNCTION _org_rental_qr_storage_readable(p_object_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_prefix text;
  v_org uuid;
  v_actor text;
  v_renter_org text;
  v_asset_id text;
BEGIN
  v_prefix := split_part(COALESCE(p_object_name, ''), '/', 1);
  IF v_prefix !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;

  v_actor := COALESCE(auth.jwt() -> 'app_metadata' ->> 'actor', '');
  IF v_actor = 'renter' THEN
    v_renter_org := COALESCE(auth.jwt() -> 'app_metadata' ->> 'organization_id', '');
    IF v_renter_org <> v_prefix THEN
      RETURN false;
    END IF;

    v_asset_id := split_part(p_object_name, '/', 2);
    IF v_asset_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN false;
    END IF;

    RETURN EXISTS (
      SELECT 1
      FROM organization_rental_qr_assets a
      WHERE a.organization_id = v_prefix::uuid
        AND a.id = v_asset_id::uuid
        AND a.storage_path = p_object_name
        AND a.is_active
    );
  END IF;

  v_org := auth_organization_id();
  IF v_org IS NULL OR v_org::text <> v_prefix THEN
    RETURN false;
  END IF;
  RETURN can_manage_settings() OR member_can_record_rental_payment();
END;
$$;

REVOKE ALL ON FUNCTION _org_rental_qr_storage_readable(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION _org_rental_qr_storage_readable(text) TO authenticated, service_role;
