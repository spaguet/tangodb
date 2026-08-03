-- rental cancellation financial actions (hall rent stage 11)
-- Run: psql $DATABASE_URL -f supabase/tests/rental_cancellation_financial_test.sql

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
  v_org uuid := 'ffffffff-ffff-ffff-ffff-fffffffffff4';
  v_user uuid := '66666666-6666-6666-6666-66666666fff4';
  v_member uuid := 'ffffffff-ffff-ffff-ffff-ffffffffff14';
  v_loc uuid := 'ffffffff-ffff-ffff-ffff-000000000214';
  v_renter uuid := 'ffffffff-ffff-ffff-ffff-000000000314';
  v_rental_unpaid uuid := 'ffffffff-ffff-ffff-ffff-000000000414';
  v_rental_paid uuid := 'ffffffff-ffff-ffff-ffff-000000000415';
  v_rental_advance uuid := 'ffffffff-ffff-ffff-ffff-000000000416';
  v_payment uuid := 'ffffffff-ffff-ffff-ffff-000000000814';
  v_result jsonb;
  v_paid numeric;
  v_advances integer;
  v_register jsonb;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    v_user,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'rental-cancel-fin@test.local',
    crypt('testpass123', gen_salt('bf')),
    now(),
    now(),
    now()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'Rental Cancel Fin Org', 'rental-cancel-fin', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'Owner Cancel')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone)
  VALUES (v_org, 'Europe/Moscow')
  ON CONFLICT (organization_id) DO UPDATE SET timezone = EXCLUDED.timezone;

  INSERT INTO locations (id, organization_id, name)
  VALUES (v_loc, v_org, 'Cancel Hall')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO renters (id, organization_id, display_name)
  VALUES (v_renter, v_org, 'Cancel Renter')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, fixed_amount, currency
  )
  VALUES
    (v_rental_unpaid, v_org, v_renter, v_loc, current_date + 7, '10:00', '12:00', 'confirmed', 2000, 'RUB'),
    (v_rental_paid, v_org, v_renter, v_loc, current_date + 8, '12:00', '14:00', 'confirmed', 3000, 'RUB'),
    (v_rental_advance, v_org, v_renter, v_loc, current_date + 9, '14:00', '16:00', 'confirmed', 1500, 'RUB')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO rental_payments (id, organization_id, rental_id, amount, currency, method, created_by)
  VALUES
    (v_payment, v_org, v_rental_paid, 3000, 'RUB', 'cash', v_member)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO rental_payments (id, organization_id, rental_id, amount, currency, method, created_by)
  SELECT
    'ffffffff-ffff-ffff-ffff-000000000815',
    v_org,
    v_rental_advance,
    1500,
    'RUB',
    'transfer',
    v_member
  WHERE NOT EXISTS (
    SELECT 1 FROM rental_payments WHERE id = 'ffffffff-ffff-ffff-ffff-000000000815'
  );

  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('app.current_organization_id', v_org::text, true);

  -- Unpaid cancel with none
  v_result := cancel_rental(v_rental_unpaid, 'Client cancelled', 'none', NULL, gen_random_uuid()::text);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'unpaid none cancel');
  PERFORM _test_assert(
    (SELECT fixed_amount FROM rentals WHERE id = v_rental_unpaid) = 0,
    'unpaid none zeros amount'
  );

  -- Paid cancel with none should fail
  v_result := cancel_rental(v_rental_paid, 'Should fail', 'none', NULL, NULL);
  PERFORM _test_assert((v_result ->> 'success')::boolean IS NOT TRUE, 'paid none should fail');

  -- Refund cancel
  v_result := cancel_rental(v_rental_paid, 'Full refund', 'refund', NULL, gen_random_uuid()::text);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'refund cancel');
  v_paid := _rental_paid_total(v_rental_paid, v_org);
  PERFORM _test_assert(v_paid = 0, 'paid total zero after refund cancel');
  PERFORM _test_assert(
    (SELECT booking_status FROM rentals WHERE id = v_rental_paid) = 'cancelled',
    'rental cancelled after refund'
  );

  -- Transfer to advance
  v_result := cancel_rental(
    v_rental_advance,
    'Move to advance',
    'transfer_to_advance',
    NULL,
    gen_random_uuid()::text
  );
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'advance cancel');
  PERFORM _test_assert(_rental_paid_total(v_rental_advance, v_org) = 0, 'paid zero after advance cancel');

  SELECT count(*)::integer INTO v_advances
  FROM rental_advances
  WHERE organization_id = v_org AND renter_id = v_renter AND amount = 1500;

  PERFORM _test_assert(v_advances >= 1, 'advance created from cancellation');

  v_register := list_rental_money_register(NULL, NULL);
  PERFORM _test_assert((v_register ->> 'success')::boolean, 'register list succeeds');
  PERFORM _test_assert(
    jsonb_array_length(coalesce(v_register -> 'entries', '[]'::jsonb)) >= 1,
    'register has entries after cancel'
  );

  RAISE NOTICE 'rental_cancellation_financial_test: OK';
END;
$$;

ROLLBACK;
