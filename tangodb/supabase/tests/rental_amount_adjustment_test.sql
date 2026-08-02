-- rental amount adjustment gate + paidExceedsFixed (hall rent stage 6)
-- Run: psql $DATABASE_URL -f supabase/tests/rental_amount_adjustment_test.sql

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
  v_org uuid := 'ffffffff-ffff-ffff-ffff-fffffffffff2';
  v_owner uuid := '66666666-6666-6666-6666-66666666fff2';
  v_admin uuid := '66666666-6666-6666-6666-66666666fff3';
  v_member_owner uuid := 'ffffffff-ffff-ffff-ffff-ffffffffff12';
  v_member_admin uuid := 'ffffffff-ffff-ffff-ffff-ffffffffff13';
  v_loc uuid := 'ffffffff-ffff-ffff-ffff-000000000212';
  v_renter uuid := 'ffffffff-ffff-ffff-ffff-000000000312';
  v_rental uuid := 'ffffffff-ffff-ffff-ffff-000000000412';
  v_result jsonb;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES
    (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rental-amt-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now()),
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rental-amt-admin@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'Rental Amount Org', 'rental-amount', 'licensed', v_version_id, v_owner)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES
    (v_member_owner, v_org, v_owner, 'owner', 'Owner Amount'),
    (v_member_admin, v_org, v_admin, 'admin', 'Admin Cashier')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, admin_can_accept_payments, admin_can_edit_schedule)
  VALUES (v_org, 'Europe/Moscow', true, true)
  ON CONFLICT (organization_id) DO UPDATE SET
    admin_can_accept_payments = true,
    admin_can_edit_schedule = true;

  INSERT INTO locations (id, organization_id, name)
  VALUES (v_loc, v_org, 'Hall B')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO renters (id, organization_id, display_name)
  VALUES (v_renter, v_org, 'Zero Amount Renter')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, fixed_amount, currency
  )
  VALUES (
    v_rental, v_org, v_renter, v_loc, current_date + 3, '14:00', '16:00',
    'confirmed', 0, 'RUB'
  )
  ON CONFLICT (id) DO UPDATE SET
    fixed_amount = 0,
    final_amount = NULL,
    calculated_amount = NULL,
    adjustment_amount = NULL,
    booking_status = 'confirmed';

  DELETE FROM rental_pricing_adjustments WHERE rental_id = v_rental;
  DELETE FROM rental_payments WHERE rental_id = v_rental;

  -- Owner: fix zero amount booking
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  PERFORM set_active_organization(v_org);

  v_result := apply_rental_pricing_adjustment(v_rental, 2500, 'Forgot tariff at booking');
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'owner adjusts zero amount');
  PERFORM _test_assert((v_result ->> 'new_amount')::numeric = 2500, 'new amount saved');

  -- Partial payment
  v_result := record_rental_payment(v_rental, 1000, 'cash', NULL, 'amt-adj-pay-1');
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'partial payment');

  -- Cannot lower below paid (including to zero)
  v_result := apply_rental_pricing_adjustment(v_rental, 0, 'Try zero');
  PERFORM _test_assert(NOT COALESCE((v_result ->> 'success')::boolean, false), 'zero blocked when paid');
  PERFORM _test_assert(v_result ->> 'error' = 'schedule.rental.paidExceedsFixed', 'paidExceedsFixed on zero');

  v_result := apply_rental_pricing_adjustment(v_rental, 500, 'Try below paid');
  PERFORM _test_assert(NOT COALESCE((v_result ->> 'success')::boolean, false), 'below paid blocked');

  -- Operational admin cashier without finance.read
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);
  PERFORM set_active_organization(v_org);

  PERFORM _test_assert(member_can_adjust_rental_amount(), 'admin cashier can adjust');
  PERFORM _test_assert(NOT can_read_financial(), 'admin still no finance.read');

  v_result := apply_rental_pricing_adjustment(v_rental, 3000, 'Cashier correction');
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'admin adjusts amount');
  PERFORM _test_assert((v_result ->> 'remaining')::numeric = 2000, 'remaining after adjustment');

  RAISE NOTICE 'rental_amount_adjustment_test: ok';
END;
$$;

ROLLBACK;
