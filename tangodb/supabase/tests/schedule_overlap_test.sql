-- Schedule versioning + overlap trigger smoke tests (SCHEDULE_TZ §7.1.1, Промпт 9)
-- Run: psql $DATABASE_URL -f supabase/tests/schedule_overlap_test.sql

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
  v_org uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  v_user uuid := '33333333-3333-3333-3333-333333333333';
  v_member uuid := 'cccccccc-cccc-cccc-cccc-cccccccccc01';
  v_client uuid := 'cccccccc-cccc-cccc-cccc-000000000001';
  v_disc uuid := 'cccccccc-cccc-cccc-cccc-000000000101';
  v_loc uuid := 'cccccccc-cccc-cccc-cccc-000000000201';
  v_slot_a uuid := 'cccccccc-cccc-cccc-cccc-000000000301';
  v_slot_b uuid := 'cccccccc-cccc-cccc-cccc-000000000302';
  v_slot_old uuid := 'cccccccc-cccc-cccc-cccc-000000000303';
  v_slot_new uuid := 'cccccccc-cccc-cccc-cccc-000000000304';
  v_personal_a uuid := 'cccccccc-cccc-cccc-cccc-000000000401';
  v_personal_b uuid := 'cccccccc-cccc-cccc-cccc-000000000402';
  v_lesson_date date := date '2026-06-18'; -- Wednesday (ISODOW 3)
  v_caught boolean;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    v_user,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'schedule-overlap@test.local',
    crypt('testpass123', gen_salt('bf')),
    now(),
    now(),
    now()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'Schedule Overlap Org', 'sched-overlap', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'Owner Schedule')
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

  -- Two active overlapping group slots in same location/day must fail
  INSERT INTO schedule_slots (
    id, organization_id, day_of_week, time, time_end, discipline_id, group_name,
    location_id, valid_from, valid_to
  )
  VALUES (
    v_slot_a, v_org, 3, '19:00', '20:00', v_disc, 'Group A', v_loc, '2000-01-01', NULL
  )
  ON CONFLICT (id) DO NOTHING;

  v_caught := false;
  BEGIN
    INSERT INTO schedule_slots (
      id, organization_id, day_of_week, time, time_end, discipline_id, group_name,
      location_id, valid_from, valid_to
    )
    VALUES (
      v_slot_b, v_org, 3, '19:30', '20:30', v_disc, 'Group B', v_loc, '2000-01-01', NULL
    );
  EXCEPTION
    WHEN OTHERS THEN
      v_caught := SQLERRM LIKE '%schedule_slot_overlap%';
  END;
  PERFORM _test_assert(v_caught, 'Active overlapping group slots must be rejected');

  -- Closed old version + new active version at same time must succeed (versioning edit)
  INSERT INTO schedule_slots (
    id, organization_id, day_of_week, time, time_end, discipline_id, group_name,
    location_id, valid_from, valid_to
  )
  VALUES (
    v_slot_old, v_org, 3, '10:00', '11:00', v_disc, 'Versioned', v_loc, '2000-01-01', v_lesson_date
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO schedule_slots (
    id, organization_id, day_of_week, time, time_end, discipline_id, group_name,
    location_id, valid_from, valid_to
  )
  VALUES (
    v_slot_new, v_org, 3, '10:00', '11:00', v_disc, 'Versioned v2', v_loc, v_lesson_date + 1, NULL
  )
  ON CONFLICT (id) DO NOTHING;

  PERFORM _test_assert(
    EXISTS (SELECT 1 FROM schedule_slots WHERE id = v_slot_new),
    'Versioned slot insert after closing old version must succeed'
  );

  -- Personal lesson overlap in same location/date must fail
  INSERT INTO personal_lessons (
    id, organization_id, type, client_id1, date, time_start, time_end,
    discipline_id, location_id, teacher_member_id, price, paid
  )
  VALUES (
    v_personal_a, v_org, 'solo', v_client, v_lesson_date, '14:00', '15:00',
    v_disc, v_loc, v_member, 1000, 'no'
  )
  ON CONFLICT (id) DO NOTHING;

  v_caught := false;
  BEGIN
    INSERT INTO personal_lessons (
      id, organization_id, type, client_id1, date, time_start, time_end,
      discipline_id, location_id, teacher_member_id, price, paid
    )
    VALUES (
      v_personal_b, v_org, 'solo', v_client, v_lesson_date, '14:30', '15:30',
      v_disc, v_loc, v_member, 1000, 'no'
    );
  EXCEPTION
    WHEN OTHERS THEN
      v_caught := SQLERRM LIKE '%personal_lesson_overlap%';
  END;
  PERFORM _test_assert(v_caught, 'Overlapping personal lessons must be rejected');

  -- Personal lesson overlapping active group slot on same date must fail
  v_caught := false;
  BEGIN
    INSERT INTO personal_lessons (
      organization_id, type, client_id1, date, time_start, time_end,
      discipline_id, location_id, teacher_member_id, price, paid
    )
    VALUES (
      v_org, 'solo', v_client, v_lesson_date, '19:15', '20:15',
      v_disc, v_loc, v_member, 1000, 'no'
    );
  EXCEPTION
    WHEN OTHERS THEN
      v_caught := SQLERRM LIKE '%personal_group_overlap%';
  END;
  PERFORM _test_assert(v_caught, 'Personal lesson overlapping group slot must be rejected');

  RAISE NOTICE 'All schedule overlap tests passed.';
END;
$$;

ROLLBACK;
