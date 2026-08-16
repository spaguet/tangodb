-- Personal tariff stage 1: RPC, debtor view, billed_from_tariff (PL-TARIFF Prompt 9)
-- Run: psql $DATABASE_URL -f supabase/tests/personal_tariff_payment_test.sql
--      npm run test:db:personal-tariff

BEGIN;

CREATE OR REPLACE FUNCTION _pt_tariff_test_assert(p_condition boolean, p_message text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_condition THEN
    RAISE EXCEPTION 'ASSERT FAILED: %', p_message;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION _pt_tariff_test_set_jwt(
  p_user_id uuid,
  p_org_id uuid,
  p_member_id uuid,
  p_role text
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', p_user_id::text,
      'organization_id', p_org_id::text,
      'member_id', p_member_id::text,
      'role', p_role
    )::text,
    true
  );
END;
$$;

DO $$
DECLARE
  v_version_id uuid;
  v_org uuid := 'd1111111-1111-4111-8111-111111111111';
  v_user uuid := 'd2222222-2222-4222-8222-222222222222';
  v_member uuid := 'd3333333-3333-4333-8333-333333333333';
  v_client1 uuid := 'd4444444-4444-4444-8444-444444444444';
  v_client2 uuid := 'd5555555-5555-4555-8555-555555555555';
  v_client3 uuid := 'd6666666-6666-4666-8666-666666666666';
  v_client4 uuid := 'd7777777-7777-4777-8777-777777777777';
  v_disc uuid := 'd8888888-8888-4888-8888-888888888888';
  v_loc uuid := 'd9999999-9999-4999-8999-999999999999';
  v_price uuid := 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_lesson_pay uuid := 'dbaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_lesson_cap uuid := 'dcaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_lesson_paid uuid := 'ddaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_lesson_pair uuid := 'deaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_lesson_quad uuid := 'dfaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_lesson_venue uuid := 'e0aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_result jsonb;
  v_payment_id uuid;
  v_status jsonb;
  v_key uuid;
  v_display text;
  v_detail text;
  v_client_id uuid;
  v_price_id uuid;
  v_units numeric;
  v_count int;
  v_lesson_dur int;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2' LIMIT 1;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pt-tariff@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'PT Tariff Org', 'pt-tariff-org', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed', owner_user_id = EXCLUDED.owner_user_id;

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET license_type = 'lifetime', activated_at = now();

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'PT Owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id)
  VALUES (v_org)
  ON CONFLICT (organization_id) DO NOTHING;

  INSERT INTO clients (id, organization_id, first_name, last_name)
  VALUES
    (v_client1, v_org, 'Alpha', 'One'),
    (v_client2, v_org, 'Beta', 'Two'),
    (v_client3, v_org, 'Gamma', 'Three'),
    (v_client4, v_org, 'Delta', 'Four')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO disciplines (id, organization_id, name)
  VALUES (v_disc, v_org, 'Tango')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO locations (id, organization_id, name)
  VALUES (v_loc, v_org, 'Studio')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO prices (id, organization_id, type, label, lessons, price, category, duration_minutes)
  VALUES (v_price, v_org, 'personal_solo', 'T45/300', 1, 300, 'private', 45)
  ON CONFLICT (id) DO UPDATE SET duration_minutes = 45, price = 300, label = 'T45/300';

  -- billed_from_tariff: 60 min lesson, 45 min tariff, 300 price → 400.00 (not 399.99)
  PERFORM _pt_tariff_test_assert(
    billed_from_tariff(300, 60, 45) = 400.00,
    'billed_from_tariff 60/45/300 = 400.00'
  );

  INSERT INTO personal_lessons (
    id, organization_id, type, client_id1, client_id2, date, discipline_id, location_id,
    time_start, time_end, price, price_id, paid, paid_amount
  )
  VALUES (
    v_lesson_pay, v_org, 'pair', v_client1, v_client2, current_date + 3, v_disc, v_loc,
    '10:00', '11:30', 600, v_price, 'no', 0
  )
  ON CONFLICT (id) DO UPDATE SET
    price = 600, price_id = v_price, paid = 'no', paid_amount = 0,
    client_id1 = v_client1, client_id2 = v_client2,
    time_start = '10:00', time_end = '11:30';

  INSERT INTO personal_lessons (
    id, organization_id, type, client_id1, date, discipline_id, location_id,
    time_start, time_end, price, price_id, paid, paid_amount
  )
  VALUES (
    v_lesson_cap, v_org, 'solo', v_client1, current_date + 4, v_disc, v_loc,
    '10:00', '11:00', 400, v_price, 'no', 0
  )
  ON CONFLICT (id) DO UPDATE SET price = 400, price_id = v_price, paid = 'no', paid_amount = 0;

  INSERT INTO personal_lessons (
    id, organization_id, type, client_id1, date, discipline_id, location_id,
    time_start, time_end, price, price_id, paid, paid_amount
  )
  VALUES (
    v_lesson_paid, v_org, 'solo', v_client1, current_date + 5, v_disc, v_loc,
    '10:00', '10:45', 300, v_price, 'yes', 300
  )
  ON CONFLICT (id) DO UPDATE SET price = 300, paid = 'yes', paid_amount = 300;

  INSERT INTO personal_lessons (
    id, organization_id, type, client_id1, client_id2, payer_client_id,
    date, discipline_id, location_id, time_start, time_end, price, price_id, paid, paid_amount
  )
  VALUES (
    v_lesson_pair, v_org, 'pair', v_client1, v_client2, v_client2,
    current_date + 6, v_disc, v_loc, '10:00', '11:30', 600, v_price, 'no', 0
  )
  ON CONFLICT (id) DO UPDATE SET
    payer_client_id = v_client2, price = 600, price_id = v_price, paid = 'no', paid_amount = 0;

  INSERT INTO personal_lessons (
    id, organization_id, type, client_id1, client_id2, client_id3, client_id4,
    payer_client_id, date, discipline_id, location_id, time_start, time_end,
    price, price_id, paid, paid_amount
  )
  VALUES (
    v_lesson_quad, v_org, 'quad', v_client1, v_client2, v_client3, v_client4,
    v_client1, current_date + 7, v_disc, v_loc, '10:00', '11:30',
    600, v_price, 'no', 0
  )
  ON CONFLICT (id) DO UPDATE SET
    client_id3 = v_client3, client_id4 = v_client4,
    price = 600, price_id = v_price, paid = 'no', paid_amount = 0;

  INSERT INTO personal_lessons (
    id, organization_id, type, client_id1, date, discipline_id, location_id,
    time_start, time_end, price, paid, paid_amount
  )
  VALUES (
    v_lesson_venue, v_org, 'solo', v_client1, current_date, v_disc, v_loc,
    '18:00', '19:00', 400, 'no', 0
  )
  ON CONFLICT (id) DO UPDATE SET price = 400, paid = 'no', paid_amount = 0;

  PERFORM _pt_tariff_test_set_jwt(v_user, v_org, v_member, 'owner');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_active_organization(v_org);

  -- Payment with payer client_id2 (not client_id1), tariff snapshot
  v_key := gen_random_uuid();
  v_result := record_personal_lesson_payment(
    v_lesson_pay,
    600,
    'cash',
    v_key,
    false,
    v_price,
    2.0000,
    45,
    300,
    'T45/300',
    90,
    v_client2
  );
  PERFORM _pt_tariff_test_assert((v_result ->> 'success')::boolean, 'payment with payer client_id2 succeeds');
  v_payment_id := (v_result ->> 'payment_id')::uuid;

  SELECT p.client_id, p.price_id, p.tariff_units, p.lesson_duration_minutes
  INTO v_client_id, v_price_id, v_units, v_lesson_dur
  FROM payments p
  WHERE p.id = v_payment_id;

  PERFORM _pt_tariff_test_assert(v_client_id = v_client2, 'payment client_id = payer (client_id2)');
  PERFORM _pt_tariff_test_assert(v_price_id = v_price, 'payment price_id set');
  PERFORM _pt_tariff_test_assert(v_units = 2.0000, 'payment tariff_units snapshot');
  PERFORM _pt_tariff_test_assert(v_lesson_dur = 90, 'payment lesson_duration_minutes snapshot');

  -- already_fully_paid
  v_result := record_personal_lesson_payment(
    v_lesson_paid, 100, 'cash', gen_random_uuid(), false
  );
  PERFORM _pt_tariff_test_assert(
    v_result ->> 'error_code' = 'already_fully_paid',
    'already_fully_paid when net paid >= price'
  );

  -- cap: amount > remaining
  v_result := record_personal_lesson_payment(
    v_lesson_cap, 500, 'cash', gen_random_uuid(), false
  );
  PERFORM _pt_tariff_test_assert(
    v_result ->> 'error_code' = 'amount_exceeds_remaining',
    'amount_exceeds_remaining when overpaying'
  );

  -- venue ack still on same RPC
  v_status := get_venue_cost_rule_status(current_date);
  IF COALESCE((v_status ->> 'acknowledgement_required')::boolean, false) THEN
    v_result := record_personal_lesson_payment(
      v_lesson_venue, 400, 'cash', gen_random_uuid(), false
    );
    PERFORM _pt_tariff_test_assert(
      v_result ->> 'error_code' = 'venue_rule_ack_required',
      'venue_rule_ack_required without acknowledgement'
    );

    v_key := gen_random_uuid();
    v_result := record_personal_lesson_payment(
      v_lesson_venue, 400, 'cash', v_key, true
    );
    PERFORM _pt_tariff_test_assert((v_result ->> 'success')::boolean, 'acknowledged payment succeeds');
  END IF;

  -- financial_debtors_v: payer display (not concat A & B)
  SELECT client_display, detail
  INTO v_display, v_detail
  FROM financial_debtors_v
  WHERE personal_lesson_id = v_lesson_pair;

  PERFORM _pt_tariff_test_assert(
    v_display LIKE '%Two%' AND v_display LIKE '%Beta%',
    'debtor client_display = payer name'
  );
  PERFORM _pt_tariff_test_assert(
    v_display NOT LIKE '%&%',
    'debtor client_display is not concat with &'
  );
  PERFORM _pt_tariff_test_assert(
    v_detail LIKE '%One Alpha%' OR v_detail LIKE '%Alpha%',
    'debtor detail mentions other participant'
  );

  -- quad: 4th client visible in detail
  SELECT detail INTO v_detail
  FROM financial_debtors_v
  WHERE personal_lesson_id = v_lesson_quad;

  PERFORM _pt_tariff_test_assert(
    v_detail LIKE '%Four%' OR v_detail LIKE '%Delta%',
    'quad debtor detail includes 4th participant'
  );

  -- single canonical overload (12 params)
  SELECT count(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'record_personal_lesson_payment';
  PERFORM _pt_tariff_test_assert(v_count = 1, 'single record_personal_lesson_payment overload');

  RAISE NOTICE 'personal_tariff_payment_test: all assertions passed';
END;
$$;

ROLLBACK;
