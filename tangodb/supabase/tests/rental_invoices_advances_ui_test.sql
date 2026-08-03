-- rental invoices/advances UI (hall rent stage 10)
-- Run: psql $DATABASE_URL -f supabase/tests/rental_invoices_advances_ui_test.sql

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
  v_payment uuid := 'ffffffff-ffff-ffff-ffff-000000000812';
  v_inv_pay uuid := 'ffffffff-ffff-ffff-ffff-000000000912';
  v_result jsonb;
  v_report jsonb;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    v_user,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'rental-invoices-ui@test.local',
    crypt('testpass123', gen_salt('bf')),
    now(),
    now(),
    now()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'Rental Invoices UI Org', 'rental-invoices-ui', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET
    status = 'licensed',
    owner_user_id = EXCLUDED.owner_user_id;
  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET
    license_type = 'lifetime',
    activated_at = now();

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'Owner Invoices UI')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone)
  VALUES (v_org, 'Europe/Moscow')
  ON CONFLICT (organization_id) DO UPDATE SET timezone = EXCLUDED.timezone;

  INSERT INTO locations (id, organization_id, name)
  VALUES (v_loc, v_org, 'Invoices Hall')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO renters (id, organization_id, display_name)
  VALUES (v_renter, v_org, 'Invoices Renter')
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
  DELETE FROM rental_advances WHERE organization_id = v_org;
  DELETE FROM rental_payments WHERE organization_id = v_org;

  INSERT INTO rental_payments (id, organization_id, rental_id, amount, method, created_by)
  VALUES (v_payment, v_org, v_rental, 1500, 'cash', v_member);

  INSERT INTO rental_invoices (
    id, organization_id, renter_id, period_start, period_end, due_date, status, total_amount, currency, created_by
  )
  VALUES (
    v_invoice, v_org, v_renter, current_date, current_date + 30, current_date + 14, 'invoiced', 5000, 'RUB', v_member
  );

  INSERT INTO rental_invoice_payments (id, organization_id, invoice_id, amount, method, created_by)
  VALUES (v_inv_pay, v_org, v_invoice, 2500, 'transfer', v_member);

  INSERT INTO rental_advances (id, organization_id, renter_id, amount, method, created_by)
  VALUES (v_advance, v_org, v_renter, 1000, 'card', v_member);

  INSERT INTO rental_advance_allocations (organization_id, advance_id, invoice_id, amount, allocated_by)
  VALUES (v_org, v_advance, v_invoice, 200, v_member);

  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');

  v_result := get_rental_accrual_report('2026-01-01'::date, '2099-12-31'::date, v_renter);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'get_rental_accrual_report success');
  v_report := v_result -> 'report';
  PERFORM _test_assert(v_report ? 'accrued_amount', 'report has accrued_amount');
  PERFORM _test_assert(v_report ? 'paid_total', 'report has paid_total');
  PERFORM _test_assert(v_report ? 'advances_received', 'report has advances_received');
  PERFORM _test_assert(v_report ? 'total_debt', 'report has total_debt');

  v_result := list_renter_rental_advances(v_renter);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'list_renter_rental_advances success');

  v_result := list_renter_rental_advance_allocations(v_renter);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'list_renter_rental_advance_allocations success');

  v_result := get_rental_accrual_report('2099-01-01'::date, '2098-12-31'::date, NULL);
  PERFORM _test_assert(NOT (v_result ->> 'success')::boolean, 'invalid period rejected');
END;
$$;

ROLLBACK;
