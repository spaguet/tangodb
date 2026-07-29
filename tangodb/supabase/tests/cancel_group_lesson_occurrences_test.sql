-- cancel_group_lesson_occurrences RPC tests (CRM scenario 2 / Prompt 2)
-- Run: psql $DATABASE_URL -f supabase/tests/cancel_group_lesson_occurrences_test.sql

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
  v_org uuid := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  v_user uuid := '55555555-5555-5555-5555-555555555555';
  v_member uuid := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01';
  v_disc uuid := 'eeeeeeee-eeee-eeee-eeee-000000000101';
  v_loc uuid := 'eeeeeeee-eeee-eeee-eeee-000000000201';
  v_class uuid := 'eeeeeeee-eeee-eeee-eeee-000000000301';
  v_series uuid := 'eeeeeeee-eeee-eeee-eeee-000000000401';
  v_wed1 date := date '2026-07-01';
  v_wed2 date := date '2026-07-08';
  v_wed3 date := date '2026-07-15';
  v_wed4 date := date '2026-07-22';
  v_result jsonb;
  v_count integer;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    v_user,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'cancel-batch@test.local',
    crypt('testpass123', gen_salt('bf')),
    now(),
    now(),
    now()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'Cancel Batch Org', 'cancel-batch', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'Owner Cancel')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id)
  VALUES (v_org)
  ON CONFLICT (organization_id) DO NOTHING;

  INSERT INTO disciplines (id, organization_id, name)
  VALUES (v_disc, v_org, 'Tango')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO locations (id, organization_id, name)
  VALUES (v_loc, v_org, 'Main Hall')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO classes (id, organization_id, name, discipline_id, default_location_id)
  VALUES (v_class, v_org, 'Group A', v_disc, v_loc)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO schedule_slots (
    id, organization_id, day_of_week, time, time_end, discipline_id, group_name,
    location_id, teacher_member_id, class_id, valid_from, valid_to
  )
  VALUES (
    v_series, v_org, 3, '20:00', '21:00', v_disc, 'Group A', v_loc, v_member, v_class,
    date '2026-06-01', NULL
  )
  ON CONFLICT (id) DO NOTHING;

  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user::text)::text, true);

  UPDATE organization_members
  SET organization_id = v_org
  WHERE id = v_member;

  -- Cancel two consecutive Wednesdays (vacation)
  v_result := cancel_group_lesson_occurrences(
    v_series,
    ARRAY[v_wed1::text, v_wed2::text]
  );

  PERFORM _test_assert((v_result ->> 'success')::boolean, 'Batch cancel should succeed');
  PERFORM _test_assert((v_result ->> 'cancelled_count')::integer = 2, 'Should cancel 2 dates');

  PERFORM _test_assert(
    NOT EXISTS (
      SELECT 1
      FROM schedule_slots s
      WHERE s.organization_id = v_org
        AND s.valid_from <= v_wed1
        AND (s.valid_to IS NULL OR s.valid_to >= v_wed1)
        AND s.day_of_week = 3
    ),
    'First cancelled Wednesday should be excluded'
  );

  PERFORM _test_assert(
    NOT EXISTS (
      SELECT 1
      FROM schedule_slots s
      WHERE s.organization_id = v_org
        AND s.valid_from <= v_wed2
        AND (s.valid_to IS NULL OR s.valid_to >= v_wed2)
        AND s.day_of_week = 3
    ),
    'Second cancelled Wednesday should be excluded'
  );

  PERFORM _test_assert(
    EXISTS (
      SELECT 1
      FROM schedule_slots s
      WHERE s.organization_id = v_org
        AND s.valid_from = v_wed3
        AND s.valid_to IS NULL
        AND s.day_of_week = 3
    ),
    'Series should resume after vacation with null valid_to'
  );

  -- Non-consecutive cancel on finite series
  DELETE FROM schedule_slots WHERE organization_id = v_org;

  INSERT INTO schedule_slots (
    id, organization_id, day_of_week, time, time_end, discipline_id, group_name,
    location_id, teacher_member_id, class_id, valid_from, valid_to
  )
  VALUES (
    v_series, v_org, 3, '20:00', '21:00', v_disc, 'Group A', v_loc, v_member, v_class,
    date '2026-06-01', date '2026-08-31'
  );

  v_result := cancel_group_lesson_occurrences(
    v_series,
    ARRAY[v_wed2::text, v_wed4::text]
  );

  PERFORM _test_assert((v_result ->> 'success')::boolean, 'Non-consecutive cancel should succeed');

  SELECT count(*) INTO v_count
  FROM schedule_slots
  WHERE organization_id = v_org;

  PERFORM _test_assert(v_count = 3, 'Non-consecutive cancel should create 3 segments');

  PERFORM _test_assert(
    NOT EXISTS (
      SELECT 1
      FROM schedule_slots s1
      JOIN schedule_slots s2
        ON s1.id <> s2.id
       AND s1.organization_id = s2.organization_id
       AND s1.day_of_week = s2.day_of_week
       AND s1.valid_from <= COALESCE(s2.valid_to, DATE '9999-12-31')
       AND s2.valid_from <= COALESCE(s1.valid_to, DATE '9999-12-31')
      WHERE s1.organization_id = v_org
    ),
    'Segments must not overlap'
  );

  -- Wrong day of week rejected
  v_result := cancel_group_lesson_occurrences(
    v_series,
    ARRAY[date '2026-07-09'::text]
  );

  PERFORM _test_assert((v_result ->> 'success')::boolean = false, 'Wrong weekday must fail');

  -- Duplicate dates rejected
  v_result := cancel_group_lesson_occurrences(
    v_series,
    ARRAY[v_wed1::text, v_wed1::text]
  );

  PERFORM _test_assert((v_result ->> 'success')::boolean = false, 'Duplicate dates must fail');
  PERFORM _test_assert(
    v_result ->> 'error' = 'schedule.error.cancelDatesDuplicate',
    'Duplicate dates must return duplicate error'
  );

  -- Idempotent re-submit
  v_result := cancel_group_lesson_occurrences(
    v_series,
    ARRAY[v_wed2::text, v_wed4::text]
  );

  PERFORM _test_assert((v_result ->> 'success')::boolean, 'Idempotent call should succeed');
  PERFORM _test_assert((v_result ->> 'already_applied')::boolean, 'Idempotent call should set already_applied');

  RAISE NOTICE 'All cancel_group_lesson_occurrences tests passed.';
END;
$$;

ROLLBACK;
