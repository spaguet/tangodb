-- Hall-rent stage 12: tariff price lookup gate (member_can_see_rental_tariff_prices)
-- Run: psql $DATABASE_URL -f supabase/tests/rental_tariff_price_lookup_test.sql

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
  v_owner uuid := '66666666-6666-6666-6666-66666666fff4';
  v_admin uuid := '66666666-6666-6666-6666-66666666fff5';
  v_reception uuid := '66666666-6666-6666-6666-66666666fff6';
  v_member_owner uuid := 'ffffffff-ffff-ffff-ffff-ffffffffff14';
  v_member_admin uuid := 'ffffffff-ffff-ffff-ffff-ffffffffff15';
  v_member_reception uuid := 'ffffffff-ffff-ffff-ffff-ffffffffff16';
  v_loc uuid := 'ffffffff-ffff-ffff-ffff-000000000214';
  v_tariff uuid := 'ffffffff-ffff-ffff-ffff-000000000314';
  v_result jsonb;
  v_price numeric;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES
    (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rental-lookup-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now()),
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rental-lookup-admin@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now()),
    (v_reception, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rental-lookup-reception@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'Rental Lookup Org', 'rental-lookup', 'licensed', v_version_id, v_owner)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name, meta)
  VALUES
    (v_member_owner, v_org, v_owner, 'owner', 'Owner Lookup', '{}'::jsonb),
    (v_member_admin, v_org, v_admin, 'admin', 'Admin Cashier', '{}'::jsonb),
    (v_member_reception, v_org, v_reception, 'admin', 'Reception', '{"restricted_admin": true}'::jsonb)
  ON CONFLICT (organization_id, user_id) DO UPDATE SET meta = EXCLUDED.meta;

  INSERT INTO organization_settings (organization_id, timezone, admin_can_accept_payments, admin_can_edit_schedule)
  VALUES (v_org, 'Europe/Moscow', true, true)
  ON CONFLICT (organization_id) DO UPDATE SET
    admin_can_accept_payments = true,
    admin_can_edit_schedule = true;

  INSERT INTO locations (id, organization_id, name)
  VALUES (v_loc, v_org, 'Lookup Hall')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO rental_tariffs (
    id, organization_id, name, tariff_type, location_id, price, currency, status
  )
  VALUES (v_tariff, v_org, 'Evening fixed', 'fixed', v_loc, 3500, 'RUB', 'active')
  ON CONFLICT (id) DO UPDATE SET price = 3500, status = 'active';

  -- Owner sees prices
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM _test_assert(member_can_see_rental_tariff_prices(), 'owner sees tariff prices');
  v_result := list_rental_tariffs('active', NULL);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'owner list tariffs');
  v_price := (v_result -> 'tariffs' -> 0 ->> 'price')::numeric;
  PERFORM _test_assert(v_price = 3500, 'owner list returns price');

  -- Full admin (cashier) sees prices without finance.read
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM _test_assert(NOT can_read_financial(), 'admin no finance.read');
  PERFORM _test_assert(member_can_record_rental_payment(), 'admin can record rental payment');
  PERFORM _test_assert(member_can_see_rental_tariff_prices(), 'admin sees tariff prices');
  v_result := list_rental_tariffs('active', NULL);
  v_price := (v_result -> 'tariffs' -> 0 ->> 'price')::numeric;
  PERFORM _test_assert(v_price = 3500, 'admin list returns price');

  -- Reception: no manage rentals, no tariff list, no prices
  PERFORM set_config('request.jwt.claim.sub', v_reception::text, true);
  PERFORM _test_assert(NOT member_can_manage_rentals(), 'reception no manage rentals');
  PERFORM _test_assert(NOT member_can_record_rental_payment(), 'reception no rental payment');
  PERFORM _test_assert(NOT member_can_see_rental_tariff_prices(), 'reception no tariff prices');
  v_result := list_rental_tariffs('active', NULL);
  PERFORM _test_assert((v_result ->> 'success') = 'false', 'reception cannot list tariffs');

  -- Stage 14: archive filter — archived tariff excluded from active list, visible when filtered.
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  v_result := upsert_rental_tariff(jsonb_build_object(
    'tariff_id', v_tariff,
    'name', 'Evening fixed',
    'tariff_type', 'fixed',
    'status', 'archived',
    'location_id', v_loc,
    'price', 3500
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'owner archives tariff');
  v_result := list_rental_tariffs('active', NULL);
  PERFORM _test_assert(jsonb_array_length(COALESCE(v_result -> 'tariffs', '[]'::jsonb)) = 0, 'active list hides archived');
  v_result := list_rental_tariffs('archived', NULL);
  PERFORM _test_assert(jsonb_array_length(COALESCE(v_result -> 'tariffs', '[]'::jsonb)) = 1, 'archived list shows tariff');
  PERFORM _test_assert((v_result -> 'tariffs' -> 0 ->> 'status') = 'archived', 'archived status preserved');
END;
$$;

ROLLBACK;
