-- rental effective amount write-path + renter CRM reads (hall rent stage 2)
-- Run: psql $DATABASE_URL -f supabase/tests/rental_effective_amount_test.sql

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
  v_org uuid := 'ffffffff-ffff-ffff-ffff-fffffffffff1';
  v_user uuid := '66666666-6666-6666-6666-66666666fff1';
  v_member uuid := 'ffffffff-ffff-ffff-ffff-ffffffffff11';
  v_loc uuid := 'ffffffff-ffff-ffff-ffff-000000000211';
  v_renter uuid := 'ffffffff-ffff-ffff-ffff-000000000311';
  v_rental uuid := 'ffffffff-ffff-ffff-ffff-000000000411';
  v_result jsonb;
  v_row jsonb;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    v_user,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'rental-effective@test.local',
    crypt('testpass123', gen_salt('bf')),
    now(),
    now(),
    now()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'Rental Effective Org', 'rental-effective', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'Owner Effective')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone)
  VALUES (v_org, 'Europe/Moscow')
  ON CONFLICT (organization_id) DO UPDATE SET timezone = EXCLUDED.timezone;

  INSERT INTO locations (id, organization_id, name)
  VALUES (v_loc, v_org, 'Main Hall')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO renters (id, organization_id, display_name)
  VALUES (v_renter, v_org, 'Adjusted Renter')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, fixed_amount, calculated_amount, final_amount, currency
  )
  VALUES (
    v_rental, v_org, v_renter, v_loc, current_date + 7, '10:00', '12:00',
    'confirmed', 5000, 5000, 3500, 'RUB'
  )
  ON CONFLICT (id) DO UPDATE SET
    fixed_amount = EXCLUDED.fixed_amount,
    calculated_amount = EXCLUDED.calculated_amount,
    final_amount = EXCLUDED.final_amount,
    booking_status = 'confirmed';

  DELETE FROM rental_payments WHERE rental_id = v_rental;

  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
  PERFORM set_active_organization(v_org);

  PERFORM _test_assert(
    _rental_effective_amount(5000::numeric, 3500::numeric) = 3500,
    'effective prefers final_amount'
  );

  v_result := list_renter_rentals(v_renter);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'list_renter_rentals success');
  v_row := (v_result -> 'rentals' -> 0);
  PERFORM _test_assert((v_row ->> 'fixed_amount')::numeric = 3500, 'list uses effective as fixed_amount');
  PERFORM _test_assert(v_row ->> 'payment_status' = 'unpaid', 'list status unpaid before payment');

  v_result := record_rental_payment(v_rental, 2000, 'cash', NULL, 'eff-amt-test-1');
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'partial payment success');
  PERFORM _test_assert(v_result ->> 'payment_status' = 'partial', 'partial against effective total');

  v_result := record_rental_payment(v_rental, 1500, 'card', NULL, 'eff-amt-test-2');
  PERFORM _test_assert(v_result ->> 'payment_status' = 'paid', 'full payment against effective total');

  v_result := record_rental_payment(v_rental, 500, 'cash', NULL, 'eff-amt-test-3');
  PERFORM _test_assert(v_result ->> 'payment_status' = 'overpaid', 'overpayment against effective total');

  PERFORM _test_assert(_renter_debt_total(v_renter, v_org) = 0, 'debt zero after full payment');

  v_result := get_renter_detail(v_renter);
  PERFORM _test_assert((v_result -> 'finance' ->> 'fixed_total')::numeric = 3500, 'renter finance fixed_total uses effective');
  PERFORM _test_assert((v_result -> 'finance' ->> 'paid_total')::numeric = 4000, 'renter finance paid_total');
  PERFORM _test_assert((v_result -> 'finance' ->> 'overpaid_total')::numeric = 500, 'renter finance overpaid_total');

  RAISE NOTICE 'rental_effective_amount_test: ok';
END;
$$;

ROLLBACK;
