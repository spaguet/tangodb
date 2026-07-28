-- move_group_lesson_occurrence RPC tests (CRM scenario 1 / Prompt 1)
-- Run: psql $DATABASE_URL -f supabase/tests/move_group_lesson_occurrence_test.sql

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
  v_user uuid := '44444444-4444-4444-4444-444444444444';
  v_member uuid := 'dddddddd-dddd-dddd-dddd-dddddddddd01';
  v_client uuid := 'dddddddd-dddd-dddd-dddd-000000000001';
  v_disc uuid := 'dddddddd-dddd-dddd-dddd-000000000101';
  v_loc uuid := 'dddddddd-dddd-dddd-dddd-000000000201';
  v_class uuid := 'dddddddd-dddd-dddd-dddd-000000000301';
  v_series uuid := 'dddddddd-dddd-dddd-dddd-000000000401';
  v_blocker uuid := 'dddddddd-dddd-dddd-dddd-000000000402';
  v_personal uuid := 'dddddddd-dddd-dddd-dddd-000000000501';
  v_wed date := date '2026-07-01'; -- Wednesday
  v_sat date := date '2026-07-04'; -- Saturday
  v_result jsonb;
  v_new_slot uuid;
  v_count integer;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    v_user,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'move-lesson@test.local',
    crypt('testpass123', gen_salt('bf')),
    now(),
    now(),
    now()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'Move Lesson Org', 'move-lesson', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'Owner Move')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id)
  VALUES (v_org)
  ON CONFLICT (organization_id) DO NOTHING;

  INSERT INTO clients (id, organization_id, first_name, last_name)
  VALUES (v_client, v_org, 'Test', 'Client')
  ON CONFLICT (id) DO NOTHING;

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

  -- Move middle occurrence Wed -> Sat
  v_result := move_group_lesson_occurrence(
    v_series,
    v_wed::text,
    v_sat::text,
    '18:00',
    '19:00'
  );

  PERFORM _test_assert((v_result ->> 'success')::boolean, 'Move should succeed');
  v_new_slot := (v_result ->> 'new_slot_id')::uuid;

  PERFORM _test_assert(
    NOT EXISTS (
      SELECT 1
      FROM schedule_slots s
      WHERE s.id = v_series
        AND s.valid_from <= v_wed
        AND (s.valid_to IS NULL OR s.valid_to >= v_wed)
    ),
    'Source Wednesday should be excluded from series'
  );

  PERFORM _test_assert(
    EXISTS (
      SELECT 1
      FROM schedule_slots s
      WHERE s.id = v_series
        AND s.valid_to = v_wed - 7
    ),
    'Series head should end before moved Wednesday'
  );

  PERFORM _test_assert(
    EXISTS (
      SELECT 1
      FROM schedule_slots s
      WHERE s.organization_id = v_org
        AND s.valid_from = v_wed + 7
        AND s.day_of_week = 3
        AND s.valid_to IS NULL
    ),
    'Series tail should resume after moved Wednesday'
  );

  PERFORM _test_assert(
    EXISTS (
      SELECT 1
      FROM schedule_slots s
      WHERE s.id = v_new_slot
        AND s.valid_from = v_sat
        AND s.valid_to = v_sat
        AND s.day_of_week = 6
        AND s.time = '18:00'
        AND s.class_id = v_class
        AND s.moved_from_slot_id = v_series
        AND s.moved_from_date = v_wed
        AND s.moved_from_time = '20:00'
    ),
    'Moved one-off slot should preserve class_id and moved_from metadata'
  );

  -- Conflict with existing group slot blocks move without DB changes
  INSERT INTO schedule_slots (
    id, organization_id, day_of_week, time, time_end, discipline_id, group_name,
    location_id, teacher_member_id, class_id, valid_from, valid_to
  )
  VALUES (
    v_blocker, v_org, 6, '18:30', '19:30', v_disc, 'Group B', v_loc, v_member, v_class,
    date '2026-06-01', NULL
  )
  ON CONFLICT (id) DO NOTHING;

  SELECT count(*) INTO v_count FROM schedule_slots WHERE organization_id = v_org;

  v_result := move_group_lesson_occurrence(
    v_series,
    (v_wed + 7)::text,
    v_sat::text,
    '18:30',
    '19:30'
  );

  PERFORM _test_assert((v_result ->> 'success')::boolean = false, 'Conflict move must fail');
  PERFORM _test_assert(
    v_result ->> 'error' = 'schedule.error.groupOverlap',
    'Conflict move must return groupOverlap error'
  );
  PERFORM _test_assert(
    (SELECT count(*) FROM schedule_slots WHERE organization_id = v_org) = v_count,
    'Conflict move must not change schedule row count'
  );

  -- Personal lesson conflict
  INSERT INTO personal_lessons (
    id, organization_id, type, client_id1, date, time_start, time_end,
    discipline_id, location_id, teacher_member_id, price, paid
  )
  VALUES (
    v_personal, v_org, 'solo', v_client, v_sat + 7, '17:00', '18:00',
    v_disc, v_loc, v_member, 1000, 'no'
  )
  ON CONFLICT (id) DO NOTHING;

  v_result := move_group_lesson_occurrence(
    v_series,
    (v_wed + 14)::text,
    (v_sat + 7)::text,
    '17:30',
    '18:30'
  );

  PERFORM _test_assert((v_result ->> 'success')::boolean = false, 'Personal overlap must fail');

  RAISE NOTICE 'All move_group_lesson_occurrence tests passed.';
END;
$$;

ROLLBACK;
