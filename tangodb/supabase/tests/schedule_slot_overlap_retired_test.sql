-- Retired tombstones (valid_to < valid_from) must not occupy dates or block writes.
-- Run: npm run test:db:schedule-slot-overlap-retired

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
  v_disc uuid := 'dddddddd-dddd-dddd-dddd-000000000101';
  v_loc uuid := 'dddddddd-dddd-dddd-dddd-000000000201';
  v_retired uuid := 'dddddddd-dddd-dddd-dddd-000000000301';
  v_new uuid := 'dddddddd-dddd-dddd-dddd-000000000302';
  v_one_day uuid := 'dddddddd-dddd-dddd-dddd-000000000303';
  v_blocked uuid := 'dddddddd-dddd-dddd-dddd-000000000304';
  v_retire_src uuid := 'dddddddd-dddd-dddd-dddd-000000000305';
  v_start date := date '2026-09-15'; -- Monday
  v_caught boolean;
  v_valid_to date;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    v_user,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'schedule-retired-overlap@test.local',
    crypt('testpass123', gen_salt('bf')),
    now(),
    now(),
    now()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'Schedule Retired Overlap Org', 'sched-retired-overlap', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization_settings (organization_id)
  VALUES (v_org)
  ON CONFLICT (organization_id) DO NOTHING;

  INSERT INTO disciplines (id, organization_id, name)
  VALUES (v_disc, v_org, 'Gymnastics')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO locations (id, organization_id, name)
  VALUES (v_loc, v_org, 'Main Hall')
  ON CONFLICT (id) DO NOTHING;

  PERFORM _test_assert(
    NOT _schedule_slot_active_on_date(v_start, v_start - 1, v_start),
    'tombstone must not be active on start date'
  );
  PERFORM _test_assert(
    _schedule_slot_active_on_date(v_start, v_start, v_start),
    'one-day class must be active on its date'
  );
  PERFORM _test_assert(
    _schedule_slot_is_retired(v_start, v_start - 1),
    'valid_to = valid_from - 1 is retired'
  );
  PERFORM _test_assert(
    NOT _schedule_slot_is_retired(v_start, v_start),
    'valid_to = valid_from is a one-day class, not retired'
  );

  -- Tombstone at Mon 19:00
  INSERT INTO schedule_slots (
    id, organization_id, day_of_week, time, time_end, discipline_id, group_name,
    location_id, valid_from, valid_to
  )
  VALUES (
    v_retired, v_org, 1, '19:00', '20:00', v_disc, 'Old Group', v_loc, v_start, v_start - 1
  )
  ON CONFLICT (id) DO NOTHING;

  v_caught := false;
  BEGIN
    INSERT INTO schedule_slots (
      id, organization_id, day_of_week, time, time_end, discipline_id, group_name,
      location_id, valid_from, valid_to
    )
    VALUES (
      v_new, v_org, 1, '19:00', '20:00', v_disc, 'New Group', v_loc, v_start, date '2026-12-31'
    );
  EXCEPTION
    WHEN OTHERS THEN
      v_caught := SQLERRM LIKE '%schedule_slot_overlap%';
  END;

  PERFORM _test_assert(NOT v_caught, 'New group slot must not conflict with retired tombstone');
  PERFORM _test_assert(
    EXISTS (SELECT 1 FROM schedule_slots WHERE id = v_new),
    'New group slot insert after retired tombstone must succeed'
  );

  -- One-day active class must still block the same time
  INSERT INTO schedule_slots (
    id, organization_id, day_of_week, time, time_end, discipline_id, group_name,
    location_id, valid_from, valid_to
  )
  VALUES (
    v_one_day, v_org, 1, '10:00', '11:00', v_disc, 'One Day', v_loc, v_start, v_start
  );

  v_caught := false;
  BEGIN
    INSERT INTO schedule_slots (
      id, organization_id, day_of_week, time, time_end, discipline_id, group_name,
      location_id, valid_from, valid_to
    )
    VALUES (
      v_blocked, v_org, 1, '10:00', '11:00', v_disc, 'Blocked', v_loc, v_start, v_start
    );
  EXCEPTION
    WHEN OTHERS THEN
      v_caught := SQLERRM LIKE '%schedule_slot_overlap%';
  END;
  PERFORM _test_assert(v_caught, 'One-day class must still overlap at the same time');

  -- Retire from first date must write valid_to = valid_from - 1 and not fail overlap
  INSERT INTO schedule_slots (
    id, organization_id, day_of_week, time, time_end, discipline_id, group_name,
    location_id, valid_from, valid_to
  )
  VALUES (
    v_retire_src, v_org, 2, '19:00', '20:00', v_disc, 'To Retire', v_loc, v_start + 1, NULL
  );

  PERFORM _retire_schedule_slot_locked(v_retire_src);
  SELECT valid_to INTO v_valid_to FROM schedule_slots WHERE id = v_retire_src;
  PERFORM _test_assert(v_valid_to = v_start, 'retire from start date must set valid_to = valid_from - 1');
  PERFORM _test_assert(
    NOT _schedule_slot_active_on_date(v_start + 1, v_valid_to, v_start + 1),
    'retired slot must occupy no dates'
  );

  RAISE NOTICE 'All schedule retired overlap tests passed.';
END;
$$;

ROLLBACK;
