-- Org override: full admin may read renter wallet / change Mini App balance
-- when organization_settings.admin_can_manage_renter_balance is on.
-- Independent of renters.finance.read (owner/director/accountant) and of occupancy.

BEGIN;

ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS admin_can_manage_renter_balance BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN organization_settings.admin_can_manage_renter_balance IS
  'Full admin: Mini App wallet read + staff topup/payout/reversal on renter card. Default off.';

CREATE OR REPLACE FUNCTION member_can_manage_renter_balance()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_role text := current_member_role();
  v_flag boolean;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN false;
  END IF;

  IF v_role IS DISTINCT FROM 'admin' THEN
    RETURN false;
  END IF;

  IF is_restricted_admin() THEN
    RETURN false;
  END IF;

  SELECT os.admin_can_manage_renter_balance
  INTO v_flag
  FROM organization_settings os
  WHERE os.organization_id = v_org_id;

  RETURN COALESCE(v_flag, false);
END;
$$;

COMMENT ON FUNCTION member_can_manage_renter_balance() IS
  'Full admin with admin_can_manage_renter_balance — not reception, not finance.read.';

CREATE OR REPLACE FUNCTION member_can_read_renter_finance()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT can_read_financial() OR member_can_manage_renter_balance();
$$;

CREATE OR REPLACE FUNCTION member_can_read_renter_directory()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT member_can_manage_rentals() OR can_read_financial() OR member_can_manage_renter_balance();
$$;

REVOKE ALL ON FUNCTION member_can_manage_renter_balance() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_can_manage_renter_balance() TO authenticated, service_role;

COMMIT;
