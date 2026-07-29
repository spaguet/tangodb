-- subscription freeze period RPC tests (CRM scenario 5 / Prompt 5)
-- Run: psql $DATABASE_URL -f supabase/tests/subscription_freeze_periods_test.sql

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
  v_org uuid := 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  v_user uuid := '66666666-6666-6666-6666-666666666666';
  v_member uuid := 'ffffffff-ffff-ffff-ffff-000000000001';
  v_client uuid := 'ffffffff-ffff-ffff-ffff-000000000101';
  v_disc uuid := 'ffffffff-ffff-ffff-ffff-000000000201';
  v_loc uuid := 'ffffffff-ffff-ffff-ffff-000000000301';
  v_class uuid := 'ffffffff-ffff-ffff-ffff-000000000401';
  v_slot uuid := 'ffffffff-ffff-ffff-ffff-000000000501';
  v_sub uuid := 'ffffffff-ffff-ffff-ffff-000000000601';
  v_price uuid := 'ffffffff-ffff-ffff-ffff-000000000701';
  v_monthly_sub uuid := 'ffffffff-ffff-ffff-ffff-000000000801';
  v_result jsonb;
  v_lessons_left int;
  v_freeze_used int;
  v_expires date;
  v_period_id uuid;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    v_user,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'freeze-period@test.local',
    crypt('testpass123', gen_salt('bf')),
    now(),
    now(),
    now()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'Freeze Period Org', 'freeze-period', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'Owner Freeze')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, freeze_enabled, freeze_max_count, freeze_min_lessons)
  VALUES (v_org, true, 2, 4)
  ON CONFLICT (organization_id) DO UPDATE
  SET freeze_enabled = EXCLUDED.freeze_enabled,
      freeze_max_count = EXCLUDED.freeze_max_count,
      freeze_min_lessons = EXCLUDED.freeze_min_lessons;

  INSERT INTO disciplines (id, organization_id, name)
  VALUES (v_disc, v_org, 'Waltz')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO locations (id, organization_id, name)
  VALUES (v_loc, v_org, 'Hall')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO classes (id, organization_id, name, discipline_id, default_location_id)
  VALUES (v_class, v_org, 'Group W', v_disc, v_loc)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO schedule_slots (
    id, organization_id, day_of_week, time, time_end, discipline_id, group_name,
    location_id, teacher_member_id, class_id, valid_from, valid_to
  )
  VALUES (
    v_slot, v_org, EXTRACT(ISODOW FROM CURRENT_DATE)::int, '18:00', '19:00', v_disc, 'Group W',
    v_loc, v_member, v_class, CURRENT_DATE - 30, NULL
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO clients (id, organization_id, first_name, last_name, phone)
  VALUES (v_client, v_org, 'Anna', 'Test', '+7000')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO prices (id, organization_id, type, lessons, price, category, billing_model)
  VALUES (v_price, v_org, 'solo', 8, 10000, 'group', 'lesson_count')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO subscriptions (
    id, organization_id, type, client_id1, lessons_total, lessons_left, freeze_used,
    activation_date, status, discipline_id, category, billing_model, price_id, expires_at
  )
  VALUES (
    v_sub, v_org, 'solo', v_client, 8, 6, 0,
    CURRENT_DATE - 14, 'active', v_disc, 'group', 'lesson_count', v_price, CURRENT_DATE + 30
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO subscription_groups (organization_id, subscription_id, schedule_group_id)
  VALUES (v_org, v_sub, v_class)
  ON CONFLICT DO NOTHING;

  INSERT INTO subscriptions (
    id, organization_id, type, client_id1, lessons_total, lessons_left, freeze_used,
    activation_date, status, discipline_id, category, billing_model, expires_at
  )
  VALUES (
    v_monthly_sub, v_org, 'solo', v_client, 0, 0, 0,
    CURRENT_DATE - 7, 'active', v_disc, 'group', 'monthly_unlimited', CURRENT_DATE + 14
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO subscription_groups (organization_id, subscription_id, schedule_group_id)
  VALUES (v_org, v_monthly_sub, v_class)
  ON CONFLICT DO NOTHING;

  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('app.current_organization_id', v_org::text, true);

  v_result := apply_subscription_freeze_period(
    v_sub::text,
    to_char(CURRENT_DATE, 'YYYY-MM-DD'),
    to_char(CURRENT_DATE + 13, 'YYYY-MM-DD'),
    'Illness'
  );
  PERFORM _test_assert((v_result->>'success')::boolean, 'apply 14-day freeze must succeed');
  PERFORM _test_assert((v_result->>'calendarDays')::int = 14, 'calendar days must be 14');

  SELECT lessons_left, freeze_used, expires_at
  INTO v_lessons_left, v_freeze_used, v_expires
  FROM subscriptions WHERE id = v_sub;

  PERFORM _test_assert(v_lessons_left = 6, 'lessons_left must stay unchanged');
  PERFORM _test_assert(v_freeze_used = 1, 'freeze_used must increase by 1');
  PERFORM _test_assert(v_expires = CURRENT_DATE + 30 + 14, 'expires_at must extend by 14 days');

  v_result := mark_attendance(
    to_char(CURRENT_DATE, 'YYYY-MM-DD'),
    v_sub::text,
    'present',
    v_disc,
    v_class
  );
  PERFORM _test_assert((v_result->>'success')::boolean, 'present during freeze must succeed');

  SELECT lessons_left INTO v_lessons_left FROM subscriptions WHERE id = v_sub;
  PERFORM _test_assert(v_lessons_left = 6, 'present during freeze must not deduct lesson');

  v_result := apply_subscription_freeze_period(
    v_sub::text,
    to_char(CURRENT_DATE, 'YYYY-MM-DD'),
    to_char(CURRENT_DATE + 13, 'YYYY-MM-DD'),
    'Duplicate'
  );
  PERFORM _test_assert((v_result->>'success')::boolean, 'idempotent apply must succeed');
  PERFORM _test_assert((v_result->>'idempotent')::boolean, 'idempotent flag expected');

  SELECT freeze_used INTO v_freeze_used FROM subscriptions WHERE id = v_sub;
  PERFORM _test_assert(v_freeze_used = 1, 'idempotent apply must not increase freeze_used');

  v_result := apply_subscription_freeze_period(
    v_monthly_sub::text,
    to_char(CURRENT_DATE + 1, 'YYYY-MM-DD'),
    to_char(CURRENT_DATE + 7, 'YYYY-MM-DD'),
    'Monthly illness'
  );
  PERFORM _test_assert((v_result->>'success')::boolean, 'monthly_unlimited freeze must succeed');

  SELECT expires_at, freeze_used
  INTO v_expires, v_freeze_used
  FROM subscriptions WHERE id = v_monthly_sub;

  PERFORM _test_assert(v_freeze_used = 1, 'monthly freeze_used must be 1');
  PERFORM _test_assert(v_expires = CURRENT_DATE + 14 + 7, 'monthly expires_at extended by 7 days');

  SELECT id INTO v_period_id
  FROM subscription_freeze_periods
  WHERE subscription_id = v_monthly_sub AND status = 'active'
  LIMIT 1;

  v_result := cancel_subscription_freeze_period(v_period_id);
  PERFORM _test_assert((v_result->>'success')::boolean, 'cancel future monthly freeze must succeed');

  SELECT expires_at, freeze_used
  INTO v_expires, v_freeze_used
  FROM subscriptions WHERE id = v_monthly_sub;

  PERFORM _test_assert(v_freeze_used = 0, 'cancel must restore freeze_used');
  PERFORM _test_assert(v_expires = CURRENT_DATE + 14, 'cancel must revert expires_at');
END;
$$;

ROLLBACK;
