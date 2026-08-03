-- Hall-rent stage 22: rental payment inbox RPC
-- Run: psql $DATABASE_URL -f supabase/tests/rental_payment_inbox_test.sql

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
  v_org uuid := 'ffffffff-ffff-ffff-ffff-fffffffffff7';
  v_owner uuid := '66666666-6666-6666-6666-66666666fff7';
  v_admin uuid := '66666666-6666-6666-6666-66666666fff8';
  v_reception uuid := '66666666-6666-6666-6666-66666666fff9';
  v_member_owner uuid := 'ffffffff-ffff-ffff-ffff-ffffffffff17';
  v_member_admin uuid := 'ffffffff-ffff-ffff-ffff-ffffffffff18';
  v_member_reception uuid := 'ffffffff-ffff-ffff-ffff-ffffffffff19';
  v_loc uuid := 'ffffffff-ffff-ffff-ffff-000000000217';
  v_renter uuid := 'ffffffff-ffff-ffff-ffff-000000000317';
  v_rental_today uuid := 'ffffffff-ffff-ffff-ffff-000000000417';
  v_rental_overdue uuid := 'ffffffff-ffff-ffff-ffff-000000000418';
  v_result jsonb;
  v_items jsonb;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES
    (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'inbox-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now()),
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'inbox-admin@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now()),
    (v_reception, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'inbox-reception@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'Rental Inbox Org', 'rental-inbox', 'licensed', v_version_id, v_owner)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name, meta)
  VALUES
    (v_member_owner, v_org, v_owner, 'owner', 'Owner Inbox', '{}'::jsonb),
    (v_member_admin, v_org, v_admin, 'admin', 'Admin Cashier', '{}'::jsonb),
    (v_member_reception, v_org, v_reception, 'admin', 'Reception', '{"restricted_admin": true}'::jsonb)
  ON CONFLICT (organization_id, user_id) DO UPDATE SET meta = EXCLUDED.meta;

  INSERT INTO organization_settings (organization_id, timezone, admin_can_accept_payments)
  VALUES (v_org, 'Europe/Moscow', true)
  ON CONFLICT (organization_id) DO UPDATE SET timezone = EXCLUDED.timezone, admin_can_accept_payments = true;

  INSERT INTO locations (id, organization_id, name)
  VALUES (v_loc, v_org, 'Inbox Hall')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO renters (id, organization_id, display_name)
  VALUES (v_renter, v_org, 'Inbox Renter')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, fixed_amount, currency
  )
  VALUES
    (v_rental_today, v_org, v_renter, v_loc, _org_local_date(v_org), '10:00', '12:00', 'confirmed', 1500, 'RUB'),
    (v_rental_overdue, v_org, v_renter, v_loc, _org_local_date(v_org) - 2, '14:00', '16:00', 'confirmed', 2000, 'RUB')
  ON CONFLICT (id) DO NOTHING;

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('app.organization_id', v_org::text, true);

  v_result := list_rental_payment_inbox('queue', NULL, NULL, NULL, NULL, NULL, 50, 0);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'owner queue success');
  v_items := v_result -> 'items';
  PERFORM _test_assert(jsonb_array_length(v_items) >= 2, 'queue has today and overdue unpaid');

  v_result := list_rental_payment_inbox('today', NULL, NULL, NULL, NULL, NULL, 50, 0);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'today bucket success');
  PERFORM _test_assert(
    NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_result -> 'items') elem
      WHERE (elem ->> 'rental_id')::uuid = v_rental_overdue
    ),
    'today excludes overdue rental'
  );

  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_result := list_rental_payment_inbox('overdue', NULL, NULL, NULL, NULL, NULL, 50, 0);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'admin overdue success');

  PERFORM set_config('request.jwt.claim.sub', v_reception::text, true);
  v_result := list_rental_payment_inbox('queue', NULL, NULL, NULL, NULL, NULL, 50, 0);
  PERFORM _test_assert(NOT COALESCE((v_result ->> 'success')::boolean, false), 'reception forbidden');

  RAISE NOTICE 'rental_payment_inbox_test: ok';
END;
$$;

ROLLBACK;
