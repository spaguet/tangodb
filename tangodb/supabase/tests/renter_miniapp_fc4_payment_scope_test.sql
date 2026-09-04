-- FC4: admin payment-accept without schedule.write; reception/teacher stay excluded.
-- Run: npm run test:db:renter-miniapp-fc4

BEGIN;

CREATE OR REPLACE FUNCTION _test_assert(p_condition boolean, p_message text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_condition THEN
    RAISE EXCEPTION 'ASSERT FAILED: %', p_message;
  END IF;
END;
$$;

DO $$
DECLARE
  v_version_id uuid;
  v_org uuid := 'fc400000-0000-4000-8000-000000000001';
  v_owner uuid := 'fc400000-0000-4000-8000-000000000011';
  v_admin uuid := 'fc400000-0000-4000-8000-000000000012';
  v_reception uuid := 'fc400000-0000-4000-8000-000000000013';
  v_member_owner uuid := 'fc400000-0000-4000-8000-000000000021';
  v_member_admin uuid := 'fc400000-0000-4000-8000-000000000022';
  v_member_reception uuid := 'fc400000-0000-4000-8000-000000000023';
  v_renter uuid := 'fc400000-0000-4000-8000-000000000041';
  v_preview jsonb;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES
    (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fc4-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now()),
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fc4-admin@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now()),
    (v_reception, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fc4-reception@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'FC4 Payment Scope Org', 'fc4-payment-scope', 'licensed', v_version_id, v_owner)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed', owner_user_id = EXCLUDED.owner_user_id;

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET license_type = 'lifetime', activated_at = now();

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name, meta)
  VALUES
    (v_member_owner, v_org, v_owner, 'owner', 'FC4 Owner', '{}'::jsonb),
    (v_member_admin, v_org, v_admin, 'admin', 'FC4 Payment Admin', '{}'::jsonb),
    (v_member_reception, v_org, v_reception, 'admin', 'FC4 Reception', '{"restricted_admin": true}'::jsonb)
  ON CONFLICT (organization_id, user_id) DO UPDATE SET
    meta = EXCLUDED.meta,
    role = EXCLUDED.role,
    display_name = EXCLUDED.display_name;

  INSERT INTO organization_settings (
    organization_id, timezone, admin_can_accept_payments, admin_can_edit_schedule
  )
  VALUES (v_org, 'Europe/Moscow', true, false)
  ON CONFLICT (organization_id) DO UPDATE SET
    admin_can_accept_payments = true,
    admin_can_edit_schedule = false,
    finance_period_closed_until = NULL;

  INSERT INTO renters (id, organization_id, display_name, status)
  VALUES (v_renter, v_org, 'FC4 Wallet Renter', 'active')
  ON CONFLICT (id) DO NOTHING;

  -- Full admin: payments without schedule occupancy
  PERFORM _hall_rent_test_set_jwt(v_admin, v_org, v_member_admin, 'admin');
  PERFORM _test_assert(NOT can_read_financial(), 'FC4 admin no finance.read');
  PERFORM _test_assert(NOT member_can_manage_rentals(), 'FC4 admin no manage rentals when schedule off');
  PERFORM _test_assert(member_can_record_rental_payment(), 'FC4 admin can record payments without schedule');
  PERFORM _test_assert(NOT member_can_read_renter_finance(), 'FC4 admin no full renter finance read');

  v_preview := preview_staff_renter_wallet_topup(jsonb_build_object(
    'renter_id', v_renter,
    'amount', 100,
    'method', 'cash'
  ));
  PERFORM _test_assert((v_preview ->> 'success')::boolean, 'FC4 admin preview topup effect');

  -- Payment flag off → no payments
  UPDATE organization_settings
  SET admin_can_accept_payments = false
  WHERE organization_id = v_org;

  PERFORM _test_assert(NOT member_can_record_rental_payment(), 'FC4 admin no payments when accept off');

  UPDATE organization_settings
  SET admin_can_accept_payments = true
  WHERE organization_id = v_org;

  -- Reception stays out of rental payment contour
  PERFORM _hall_rent_test_set_jwt(v_reception, v_org, v_member_reception, 'admin');
  PERFORM _test_assert(NOT member_can_record_rental_payment(), 'FC4 reception no rental payment');
  PERFORM _test_assert(NOT member_can_manage_rentals(), 'FC4 reception no manage rentals');

  -- Owner still has finance path
  PERFORM _hall_rent_test_set_jwt(v_owner, v_org, v_member_owner, 'owner');
  PERFORM _test_assert(member_can_record_rental_payment(), 'FC4 owner can record payments');
  PERFORM _test_assert(member_can_read_renter_finance(), 'FC4 owner renter finance read');
END;
$$;

ROLLBACK;
