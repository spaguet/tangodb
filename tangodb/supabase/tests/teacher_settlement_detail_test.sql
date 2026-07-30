-- teacher settlement detail tests (CRM scenario 8 / Prompt 8)
-- Run: psql $DATABASE_URL -f supabase/tests/teacher_settlement_detail_test.sql

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
  v_org uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  v_user uuid := '66666666-6666-6666-6666-666666666666';
  v_teacher_member uuid := 'dddddddd-dddd-dddd-dddd-000000000001';
  v_other_teacher uuid := 'dddddddd-dddd-dddd-dddd-000000000002';
  v_client uuid := 'dddddddd-dddd-dddd-dddd-000000000101';
  v_disc uuid := 'dddddddd-dddd-dddd-dddd-000000000201';
  v_loc uuid := 'dddddddd-dddd-dddd-dddd-000000000301';
  v_class uuid := 'dddddddd-dddd-dddd-dddd-000000000401';
  v_sub uuid := 'dddddddd-dddd-dddd-dddd-000000000501';
  v_price uuid := 'dddddddd-dddd-dddd-dddd-000000000601';
  v_payment uuid := 'dddddddd-dddd-dddd-dddd-000000000701';
  v_settlement_id uuid;
  v_detail jsonb;
  v_lines_total numeric;
  v_accrued numeric;
  v_line_count int;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    v_user,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'payroll-detail@test.local',
    crypt('testpass123', gen_salt('bf')),
    now(),
    now(),
    now()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'Payroll Detail Org', 'payroll-detail', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES
    (v_teacher_member, v_org, v_user, 'teacher', 'Teacher Detail'),
    (v_other_teacher, v_org, v_user, 'owner', 'Owner Detail')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO disciplines (id, organization_id, name)
  VALUES (v_disc, v_org, 'Tango')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO locations (id, organization_id, name)
  VALUES (v_loc, v_org, 'Studio A')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO classes (id, organization_id, name, discipline_id, default_location_id)
  VALUES (v_class, v_org, 'Beginners', v_disc, v_loc)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO schedule_slots (
    id, organization_id, class_id, group_name, discipline_id, location_id,
    teacher_member_id, day_of_week, time_start, time_end, valid_from, valid_to
  )
  VALUES (
    'dddddddd-dddd-dddd-dddd-000000000801',
    v_org, v_class, 'Beginners', v_disc, v_loc,
    v_teacher_member, 1, '19:00', '20:00', CURRENT_DATE - 30, NULL
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO clients (id, organization_id, first_name, last_name)
  VALUES (v_client, v_org, 'Test', 'Client')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO prices (id, organization_id, type, lessons, price, category, discipline_id)
  VALUES (v_price, v_org, 'group', 8, 8000, 'group', v_disc)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO subscriptions (
    id, organization_id, client_id, client_id2, price_id, status,
    lessons_total, lessons_left, price, purchased_at, expires_at
  )
  VALUES (
    v_sub, v_org, v_client, v_client, v_price, 'active',
    8, 7, 8000, CURRENT_DATE - 5, CURRENT_DATE + 30
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO subscription_groups (id, organization_id, subscription_id, schedule_group_id)
  VALUES ('dddddddd-dddd-dddd-dddd-000000000901', v_org, v_sub, v_class)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO teacher_pay_rates (
    id, organization_id, member_id, pay_mode, fixed_amount,
    rate_percent, group_rate_percent, personal_rate_percent, single_visit_rate_percent,
    effective_from
  )
  VALUES (
    'dddddddd-dddd-dddd-dddd-000000000a01',
    v_org, v_teacher_member, 'fixed_plus_percent', 5000,
    10, 10, 15, 12,
    CURRENT_DATE - 60
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO payments (
    id, organization_id, client_id, client_display, amount, method,
    subscription_id, created_by, created_at
  )
  VALUES (
    v_payment, v_org, v_client, 'Test Client', 8000, 'cash',
    v_sub, v_other_teacher, date_trunc('month', CURRENT_DATE) + interval '2 days'
  )
  ON CONFLICT (id) DO NOTHING;

  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('app.current_organization_id', v_org::text, true);

  PERFORM recalculate_teacher_settlement(
    v_org,
    EXTRACT(YEAR FROM CURRENT_DATE)::int,
    EXTRACT(MONTH FROM CURRENT_DATE)::int
  );

  SELECT id, amount_accrued
  INTO v_settlement_id, v_accrued
  FROM teacher_settlements
  WHERE organization_id = v_org
    AND member_id = v_teacher_member
    AND period_year = EXTRACT(YEAR FROM CURRENT_DATE)::int
    AND period_month = EXTRACT(MONTH FROM CURRENT_DATE)::int;

  PERFORM _test_assert(v_settlement_id IS NOT NULL, 'settlement created');
  PERFORM _test_assert(v_accrued = 5800, 'accrued = fixed 5000 + 10% of 8000');

  SELECT COUNT(*)
  INTO v_line_count
  FROM teacher_settlement_line_items
  WHERE settlement_id = v_settlement_id;

  PERFORM _test_assert(v_line_count = 2, 'two line items: fixed + group payment');

  SELECT get_teacher_settlement_detail(v_settlement_id)
  INTO v_detail;

  PERFORM _test_assert((v_detail -> 'reconciliation' ->> 'matches')::boolean, 'detail reconciliation matches');

  v_lines_total := (v_detail -> 'reconciliation' ->> 'linesTotal')::numeric;
  PERFORM _test_assert(v_lines_total = v_accrued, 'lines total equals accrued');

  -- Teacher cannot read other teacher settlement
  BEGIN
    PERFORM get_teacher_settlement_detail((
      SELECT id FROM teacher_settlements
      WHERE organization_id = v_org AND member_id = v_other_teacher
      LIMIT 1
    ));
    PERFORM _test_assert(false, 'teacher should not read other settlement');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$$;

ROLLBACK;
