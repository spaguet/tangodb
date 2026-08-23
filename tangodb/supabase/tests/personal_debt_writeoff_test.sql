-- 950000 billed / 800000 paid leftover → write-off and correct_payment billed sync.
-- Run: psql $DATABASE_URL -f supabase/tests/personal_debt_writeoff_test.sql
--      npm run test:db:personal-debt-writeoff

BEGIN;

CREATE OR REPLACE FUNCTION _pdw_assert(p_condition boolean, p_message text)
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
  v_org uuid := 'f1111111-1111-4111-8111-111111111111';
  v_user uuid := 'f2222222-2222-4222-8222-222222222222';
  v_member uuid := 'f3333333-3333-4333-8333-333333333333';
  v_client uuid := 'f4444444-4444-4444-8444-444444444444';
  v_disc uuid := 'f5555555-5555-4555-8555-555555555555';
  v_loc uuid := 'f6666666-6666-4666-8666-666666666666';
  v_lesson uuid := 'f7777777-7777-4777-8777-777777777777';
  v_lesson2 uuid := 'f8888888-8888-4888-8888-888888888888';
  v_charge uuid;
  v_payment uuid;
  v_result jsonb;
  v_billed numeric;
  v_paid numeric;
  v_debt numeric;
  v_version_id uuid;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2' LIMIT 1;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pdw@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'PDW org', 'pdw-org', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed', owner_user_id = EXCLUDED.owner_user_id;

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET license_type = 'lifetime', activated_at = now();

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'PDW Owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id)
  VALUES (v_org)
  ON CONFLICT (organization_id) DO NOTHING;

  INSERT INTO disciplines (id, organization_id, name)
  VALUES (v_disc, v_org, 'Tango')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO locations (id, organization_id, name)
  VALUES (v_loc, v_org, 'Hall')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO clients (id, organization_id, first_name, last_name)
  VALUES (v_client, v_org, 'Анастасия', 'Санько')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO personal_lessons (
    id, organization_id, type, date, time_start, time_end, client_id1, payer_client_id,
    discipline_id, location_id, teacher_member_id, price, paid, paid_amount, billing_split_mode
  ) VALUES (
    v_lesson, v_org, 'solo', CURRENT_DATE, '10:00', '11:00', v_client, v_client,
    v_disc, v_loc, v_member, 950000, 'no', 0, 'single_payer'
  );

  SELECT id INTO v_charge
  FROM personal_lesson_charges
  WHERE organization_id = v_org AND personal_lesson_id = v_lesson;

  PERFORM _pdw_assert(v_charge IS NOT NULL, 'charge created');
  UPDATE personal_lesson_charges SET billed_amount = 950000 WHERE id = v_charge;

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', v_user::text,
      'organization_id', v_org::text,
      'member_id', v_member::text,
      'role', 'owner'
    )::text,
    true
  );

  INSERT INTO payments (
    organization_id, client_id, client_display, amount, method,
    personal_lesson_id, personal_lesson_charge_id, created_by, operation_kind
  ) VALUES (
    v_org, v_client, 'Санько Анастасия', 800000, 'cash',
    v_lesson, v_charge, v_member, 'payment'
  ) RETURNING id INTO v_payment;

  PERFORM sync_personal_lesson_paid_status(v_org, v_lesson);

  SELECT
    plc.billed_amount,
    personal_lesson_charge_net_payment(v_org, plc.id)
  INTO v_billed, v_paid
  FROM personal_lesson_charges plc
  WHERE plc.id = v_charge;

  v_debt := GREATEST(v_billed - v_paid, 0);
  PERFORM _pdw_assert(v_billed = 950000, 'billed stays 950000');
  PERFORM _pdw_assert(v_paid = 800000, 'paid 800000');
  PERFORM _pdw_assert(v_debt = 150000, 'leftover debt 150000');

  v_result := write_off_personal_lesson_debt(v_lesson, v_charge, 'wrong_amount', 'назначенная сумма 800000');
  PERFORM _pdw_assert((v_result ->> 'success')::boolean, 'write-off success');
  PERFORM _pdw_assert((v_result ->> 'written_off')::numeric = 150000, 'wrote off 150000');

  SELECT
    plc.billed_amount,
    personal_lesson_charge_net_payment(v_org, plc.id)
  INTO v_billed, v_paid
  FROM personal_lesson_charges plc
  WHERE plc.id = v_charge;

  PERFORM _pdw_assert(v_billed = 800000, 'billed restated to paid');
  PERFORM _pdw_assert(GREATEST(v_billed - v_paid, 0) = 0, 'no leftover debt');

  v_result := get_personal_lesson_debt_trace(v_lesson, v_charge);
  PERFORM _pdw_assert((v_result ->> 'success')::boolean, 'trace success');
  PERFORM _pdw_assert(jsonb_array_length(v_result -> 'events') >= 2, 'trace has events');

  INSERT INTO personal_lessons (
    id, organization_id, type, date, time_start, time_end, client_id1, payer_client_id,
    discipline_id, location_id, teacher_member_id, price, paid, paid_amount, billing_split_mode
  ) VALUES (
    v_lesson2, v_org, 'solo', CURRENT_DATE, '12:00', '13:00', v_client, v_client,
    v_disc, v_loc, v_member, 950000, 'no', 0, 'single_payer'
  );

  SELECT id INTO v_charge
  FROM personal_lesson_charges
  WHERE organization_id = v_org AND personal_lesson_id = v_lesson2;

  INSERT INTO payments (
    organization_id, client_id, client_display, amount, method,
    personal_lesson_id, personal_lesson_charge_id, created_by, operation_kind
  ) VALUES (
    v_org, v_client, 'Санько Анастасия', 950000, 'cash',
    v_lesson2, v_charge, v_member, 'payment'
  ) RETURNING id INTO v_payment;

  v_result := correct_payment(v_payment, 800000, 'cash', 'wrong_amount', 'исправление суммы', gen_random_uuid());
  PERFORM _pdw_assert((v_result ->> 'success')::boolean, 'correct_payment success');
  PERFORM _pdw_assert(COALESCE((v_result ->> 'billed_restated')::boolean, false), 'billed restated on correct');

  SELECT billed_amount INTO v_billed
  FROM personal_lesson_charges
  WHERE id = v_charge;
  PERFORM _pdw_assert(v_billed = 800000, 'correct_payment updates billed');
END;
$$;

ROLLBACK;
