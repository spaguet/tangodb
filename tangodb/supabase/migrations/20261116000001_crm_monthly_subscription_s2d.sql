-- S2d / 2.11.4: revoke authenticated INSERT on platform_purchase_requests (Edge/RPC only).

BEGIN;

DROP POLICY IF EXISTS platform_purchase_requests_insert_owner_director
  ON platform_purchase_requests;

REVOKE INSERT ON platform_purchase_requests FROM authenticated;

CREATE OR REPLACE FUNCTION platform_purchase_requests_kind_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_role text;
BEGIN
  v_role := COALESCE(auth.role(), current_setting('role', true));

  IF NEW.request_kind = 'renter_miniapp_addon' AND v_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'purchase_request_kind_forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF v_role = 'authenticated' THEN
    RAISE EXCEPTION 'purchase_request_kind_forbidden'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
