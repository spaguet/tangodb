-- Hall-rent stage 13: create_rental cash gate + preview_rental_pricing
-- Run: psql $DATABASE_URL -f supabase/tests/rental_create_cash_gate_test.sql

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
  v_org uuid := 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  v_owner_user uuid := '66666666-6666-6666-6666-666666666666';
  v_admin_user uuid := '66666666-6666-6666-6666-666666666667';
  v_owner_member uuid := 'ffffffff-ffff-ffff-ffff-ffffffffff01';
  v_admin_member uuid := 'ffffffff-ffff-ffff-ffff-ffffffffff02';
  v_loc uuid := 'ffffffff-ffff-ffff-ffff-000000000201';
  v_renter uuid := 'ffffffff-ffff-ffff-ffff-000000000301';
  v_tariff_fixed uuid := 'ffffffff-ffff-ffff-ffff-000000000402';
  v_result jsonb;
  v_rental_id uuid;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES
    (v_owner_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rental-create-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now()),
    (v_admin_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rental-create-admin@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'Rental Create Gate Org', 'rental-create-gate', 'licensed', v_version_id, v_owner_user)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES
    (v_owner_member, v_org, v_owner_user, 'owner', 'Owner'),
    (v_admin_member, v_org, v_admin_user, 'admin', 'Admin Cashier')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, admin_can_accept_payments, admin_can_edit_schedule)
  VALUES (v_org, 'Europe/Moscow', true, true)
  ON CONFLICT (organization_id) DO UPDATE SET
    admin_can_accept_payments = true,
    admin_can_edit_schedule = true;

  INSERT INTO locations (id, organization_id, name)
  VALUES (v_loc, v_org, 'Hall A')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO renters (id, organization_id, display_name)
  VALUES (v_renter, v_org, 'Test Renter')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO rental_tariffs (id, organization_id, name, tariff_type, location_id, price, currency, min_duration_minutes, rounding_step_minutes, status)
  VALUES (v_tariff_fixed, v_org, 'Fixed Event', 'fixed', v_loc, 3000, 'RUB', 0, 1, 'active')
  ON CONFLICT (id) DO NOTHING;

  -- Admin cashier: preview pricing
  PERFORM set_config('request.jwt.claim.sub', v_admin_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_user)::text, true);
  PERFORM set_active_organization(v_org);

  v_result := preview_rental_pricing(jsonb_build_object(
    'tariff_id', v_tariff_fixed,
    'rental_date', '2026-04-01',
    'time_start', '10:00',
    'time_end', '14:00'
  ));
  PERFORM _test_assert(COALESCE((v_result ->> 'success')::boolean, false), 'admin preview pricing');
  PERFORM _test_assert((v_result ->> 'calculated_amount')::numeric = 3000, 'fixed tariff amount 3000');

  -- Create with tariff_id (server price, no finance.read on admin)
  v_result := create_rental(jsonb_build_object(
    'idempotency_key', 'stage13-admin-tariff',
    'rental_date', '2026-04-02',
    'time_start', '10:00',
    'time_end', '14:00',
    'location_id', v_loc,
    'renter_id', v_renter,
    'tariff_id', v_tariff_fixed,
    'fixed_amount', 0,
    'initial_payment', 1500,
    'payment_method', 'cash'
  ));
  PERFORM _test_assert(COALESCE((v_result ->> 'success')::boolean, false), 'admin create with tariff + initial payment');
  v_rental_id := (v_result ->> 'rental_id')::uuid;
  PERFORM _test_assert((SELECT fixed_amount FROM rentals WHERE id = v_rental_id) = 3000, 'stored amount from tariff');

  -- Override without reason blocked
  v_result := create_rental(jsonb_build_object(
    'idempotency_key', 'stage13-admin-overrides',
    'rental_date', '2026-04-03',
    'time_start', '10:00',
    'time_end', '14:00',
    'location_id', v_loc,
    'renter_id', v_renter,
    'tariff_id', v_tariff_fixed,
    'fixed_amount', 2500
  ));
  PERFORM _test_assert(NOT COALESCE((v_result ->> 'success')::boolean, false), 'override without reason fails');
  PERFORM _test_assert(v_result ->> 'error' = 'schedule.rental.amountOverrideReasonRequired', 'override reason error code');

  -- Override with reason
  v_result := create_rental(jsonb_build_object(
    'idempotency_key', 'stage13-admin-overrides-ok',
    'rental_date', '2026-04-04',
    'time_start', '10:00',
    'time_end', '14:00',
    'location_id', v_loc,
    'renter_id', v_renter,
    'tariff_id', v_tariff_fixed,
    'fixed_amount', 2500,
    'amount_override_reason', 'Discount agreed'
  ));
  PERFORM _test_assert(COALESCE((v_result ->> 'success')::boolean, false), 'override with reason succeeds');
  v_rental_id := (v_result ->> 'rental_id')::uuid;
  PERFORM _test_assert((SELECT fixed_amount FROM rentals WHERE id = v_rental_id) = 2500, 'override amount stored');
  PERFORM _test_assert((SELECT adjustment_amount FROM rentals WHERE id = v_rental_id) = -500, 'adjustment -500');

  -- Manual amount without tariff requires cash gate (admin passes)
  v_result := create_rental(jsonb_build_object(
    'idempotency_key', 'stage13-admin-manual',
    'rental_date', '2026-04-05',
    'time_start', '10:00',
    'time_end', '14:00',
    'location_id', v_loc,
    'renter_id', v_renter,
    'fixed_amount', 1800
  ));
  PERFORM _test_assert(COALESCE((v_result ->> 'success')::boolean, false), 'admin manual fixed amount');
END;
$$;

ROLLBACK;
