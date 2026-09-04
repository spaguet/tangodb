-- FC4: rental payments independent of schedule occupancy (P1-21).
-- Full admin with admin_can_accept_payments may record rental / topup payments
-- without admin_can_edit_schedule. Occupancy stays member_can_manage_rentals().

BEGIN;

CREATE OR REPLACE FUNCTION member_can_record_rental_payment()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_role text := current_member_role();
  v_admin_can_accept boolean;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN false;
  END IF;

  IF can_read_financial() THEN
    RETURN true;
  END IF;

  IF v_role = 'admin' THEN
    IF is_restricted_admin() THEN
      RETURN false;
    END IF;

    SELECT os.admin_can_accept_payments
    INTO v_admin_can_accept
    FROM organization_settings os
    WHERE os.organization_id = v_org_id;

    RETURN COALESCE(v_admin_can_accept, true);
  END IF;

  RETURN false;
END;
$$;

COMMENT ON FUNCTION member_can_record_rental_payment() IS
  'FC4: finance roles OR full admin with payment-accept — not tied to schedule.write / manage_rentals.';

COMMIT;
