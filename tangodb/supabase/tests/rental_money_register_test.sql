-- rental money register (hall rent stage 5)
-- Run: psql $DATABASE_URL -f supabase/tests/rental_money_register_test.sql

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
  v_user uuid := '66666666-6666-6666-6666-66666666fff2';
  v_member uuid := 'ffffffff-ffff-ffff-ffff-ffffffffff12';
  v_loc uuid := 'ffffffff-ffff-ffff-ffff-000000000212';
  v_renter uuid := 'ffffffff-ffff-ffff-ffff-000000000312';
  v_rental uuid := 'ffffffff-ffff-ffff-ffff-000000000412';
  v_invoice uuid := 'ffffffff-ffff-ffff-ffff-000000000512';
  v_advance uuid := 'ffffffff-ffff-ffff-ffff-000000000612';
  v_deposit uuid := 'ffffffff-ffff-ffff-ffff-000000000712';
  v_payment uuid := 'ffffffff-ffff-ffff-ffff-000000000812';
  v_inv_pay uuid := 'ffffffff-ffff-ffff-ffff-000000000912';
  v_dep_mov uuid := 'ffffffff-ffff-ffff-ffff-000000000a12';
  v_hold_mov uuid := 'ffffffff-ffff-ffff-ffff-000000000b12';
  v_result jsonb;
  v_entries jsonb;
  v_count integer;
  v_dupes integer;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    v_user,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'rental-register@test.local',
    crypt('testpass123', gen_salt('bf')),
    now(),
    now(),
    now()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'Rental Register Org', 'rental-register', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'Owner Register')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone)
  VALUES (v_org, 'Europe/Moscow')
  ON CONFLICT (organization_id) DO UPDATE SET timezone = EXCLUDED.timezone;

  INSERT INTO locations (id, organization_id, name)
  VALUES (v_loc, v_org, 'Register Hall')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO renters (id, organization_id, display_name)
  VALUES (v_renter, v_org, 'Register Renter')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, fixed_amount, currency
  )
  VALUES (
    v_rental, v_org, v_renter, v_loc, current_date + 3, '10:00', '12:00',
    'confirmed', 2000, 'RUB'
  )
  ON CONFLICT (id) DO NOTHING;

  DELETE FROM rental_advance_allocations WHERE organization_id = v_org;
  DELETE FROM rental_invoice_payments WHERE organization_id = v_org;
  DELETE FROM rental_invoice_lines WHERE organization_id = v_org;
  DELETE FROM rental_invoices WHERE organization_id = v_org;
  DELETE FROM rental_deposit_movements WHERE organization_id = v_org;
  DELETE FROM rental_deposits WHERE organization_id = v_org;
  DELETE FROM rental_advances WHERE organization_id = v_org;
  DELETE FROM rental_payments WHERE organization_id = v_org;

  INSERT INTO rental_payments (id, organization_id, rental_id, amount, method, created_by)
  VALUES (v_payment, v_org, v_rental, 1500, 'cash', v_member);

  INSERT INTO rental_invoices (
    id, organization_id, renter_id, period_start, period_end, status, total_amount, currency, created_by
  )
  VALUES (
    v_invoice, v_org, v_renter, current_date, current_date + 30, 'invoiced', 5000, 'RUB', v_member
  );

  INSERT INTO rental_invoice_payments (id, organization_id, invoice_id, amount, method, created_by)
  VALUES (v_inv_pay, v_org, v_invoice, 2500, 'transfer', v_member);

  INSERT INTO rental_advances (id, organization_id, renter_id, amount, method, created_by)
  VALUES (v_advance, v_org, v_renter, 1000, 'card', v_member);

  INSERT INTO rental_deposits (id, organization_id, renter_id, required_amount, balance, currency)
  VALUES (v_deposit, v_org, v_renter, 10000, 3000, 'RUB');

  INSERT INTO rental_deposit_movements (id, organization_id, deposit_id, movement_type, amount, reason, created_by)
  VALUES (v_dep_mov, v_org, v_deposit, 'receive', 3000, 'Initial deposit', v_member);

  INSERT INTO rental_deposit_movements (id, organization_id, deposit_id, movement_type, amount, reason, created_by)
  VALUES (v_hold_mov, v_org, v_deposit, 'hold', 500, 'Hold test', v_member);

  INSERT INTO rental_advance_allocations (organization_id, advance_id, invoice_id, amount, allocated_by)
  VALUES (v_org, v_advance, v_invoice, 200, v_member);

  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  v_result := list_rental_money_register(NULL, NULL);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'list_rental_money_register should succeed for owner');
  v_entries := v_result -> 'entries';
  v_count := jsonb_array_length(v_entries);
  PERFORM _test_assert(v_count = 4, 'register should have 4 cash entries (direct, invoice, advance, deposit receive)');

  PERFORM _test_assert(
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_entries) e
      WHERE e ->> 'entry_type' = 'direct_booking_payment' AND (e ->> 'signed_amount')::numeric = 1500
    ),
    'direct booking payment in register'
  );
  PERFORM _test_assert(
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_entries) e
      WHERE e ->> 'entry_type' = 'invoice_payment' AND (e ->> 'signed_amount')::numeric = 2500
    ),
    'invoice payment in register'
  );
  PERFORM _test_assert(
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_entries) e
      WHERE e ->> 'entry_type' = 'advance_received' AND (e ->> 'signed_amount')::numeric = 1000
    ),
    'advance received in register'
  );
  PERFORM _test_assert(
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_entries) e
      WHERE e ->> 'entry_type' = 'deposit_receive' AND (e ->> 'signed_amount')::numeric = 3000
    ),
    'deposit receive in register'
  );
  PERFORM _test_assert(
    NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_entries) e
      WHERE e ->> 'entry_type' LIKE '%allocation%'
    ),
    'advance allocation must not appear in register'
  );

  SELECT count(*) - count(DISTINCT register_key)
  INTO v_dupes
  FROM rental_money_register_v
  WHERE organization_id = v_org;

  PERFORM _test_assert(v_dupes = 0, 'register_key must be unique per org');

  RAISE NOTICE 'rental_money_register_test: OK (% entries)', v_count;
END;
$$;

ROLLBACK;
