-- Retired schedule_slots must not block new group slot at the same day/time/location.
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
  v_start date := date '2026-09-15'; -- Monday
  v_caught boolean;
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

  -- Retired tombstone at Mon 19:00 starting Sep 15
  INSERT INTO schedule_slots (
    id, organization_id, day_of_week, time, time_end, discipline_id, group_name,
    location_id, valid_from, valid_to
  )
  VALUES (
    v_retired, v_org, 1, '19:00', '20:00', v_disc, 'Old Group', v_loc, v_start, v_start
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

  RAISE NOTICE 'All schedule retired overlap tests passed.';
END;
$$;

ROLLBACK;
