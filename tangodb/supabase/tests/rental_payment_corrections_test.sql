-- rental payment corrections (hall rent stage 8)
-- Run: psql $DATABASE_URL -f supabase/tests/rental_payment_corrections_test.sql

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
  v_org uuid := 'ffffffff-ffff-ffff-ffff-fffffffffff3';
  v_user uuid := '66666666-6666-6666-6666-66666666fff3';
  v_member uuid := 'ffffffff-ffff-ffff-ffff-ffffffffff13';
  v_loc uuid := 'ffffffff-ffff-ffff-ffff-000000000213';
  v_renter uuid := 'ffffffff-ffff-ffff-ffff-000000000313';
  v_rental uuid := 'ffffffff-ffff-ffff-ffff-000000000413';
  v_payment uuid := 'ffffffff-ffff-ffff-ffff-000000000813';
  v_result jsonb;
  v_paid numeric;
  v_debtors integer;
  v_register jsonb;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    v_user,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'rental-corrections@test.local',
    crypt('testpass123', gen_salt('bf')),
    now(),
    now(),
    now()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'Rental Corrections Org', 'rental-corrections', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'Owner Corrections')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone)
  VALUES (v_org, 'Europe/Moscow')
  ON CONFLICT (organization_id) DO UPDATE SET timezone = EXCLUDED.timezone;

  INSERT INTO locations (id, organization_id, name)
  VALUES (v_loc, v_org, 'Corrections Hall')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO renters (id, organization_id, display_name, contact_phone)
  VALUES (v_renter, v_org, 'Debtor Renter', '+79990001122')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, fixed_amount, currency
  )
  VALUES (
    v_rental, v_org, v_renter, v_loc, current_date + 5, '14:00', '16:00',
    'confirmed', 3000, 'RUB'
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO rental_payments (
    id, organization_id, rental_id, amount, currency, method, created_by
  )
  VALUES (v_payment, v_org, v_rental, 1000, 'RUB', 'cash', v_member)
  ON CONFLICT (id) DO NOTHING;

  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('app.current_organization_id', v_org::text, true);

  PERFORM _test_assert(_rental_paid_total(v_rental, v_org) = 1000, 'initial paid total');

  SELECT count(*)::integer INTO v_debtors
  FROM financial_debtors_v
  WHERE organization_id = v_org AND kind = 'rental' AND rental_id = v_rental;

  PERFORM _test_assert(v_debtors = 1, 'rental debtor visible in financial_debtors_v');

  v_result := storno_rental_payment(
    v_payment,
    400,
    'duplicate',
    'partial storno test',
    gen_random_uuid()::text
  );
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'partial storno should succeed');
  PERFORM _test_assert(_rental_paid_total(v_rental, v_org) = 600, 'paid total after partial storno');

  v_result := correct_rental_payment(
    v_payment,
    500,
    'card',
    'wrong_method',
    'method fix',
    gen_random_uuid()::text
  );
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'correct rental payment should succeed');
  PERFORM _test_assert(_rental_paid_total(v_rental, v_org) = 500, 'paid total after correction');

  v_result := get_corrections_report(NULL, NULL);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'corrections report should succeed');
  PERFORM _test_assert(
    jsonb_array_length(coalesce(v_result -> 'rental_payments', '[]'::jsonb)) >= 2,
    'corrections report should list rental corrections'
  );

  v_result := list_rental_money_register(NULL, NULL);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'register list should succeed');

  SELECT count(*)::integer INTO v_debtors
  FROM jsonb_array_elements(v_result -> 'entries') e
  WHERE e ->> 'entry_type' IN ('direct_booking_payment', 'direct_booking_storno');

  PERFORM _test_assert(v_debtors >= 3, 'register should include payment + storno + replacement');

  RAISE NOTICE 'rental_payment_corrections_test: OK';
END;
$$;

ROLLBACK;
