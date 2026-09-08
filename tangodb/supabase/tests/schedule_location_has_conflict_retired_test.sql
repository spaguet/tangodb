-- schedule_location_has_conflict ignores retired slots and cancelled group occurrences.
-- Run: npm run test:db:schedule-location-conflict

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
  v_org uuid := 'ffffffff-ffff-ffff-ffff-fffffffffff1';
  v_user uuid := '66666666-6666-6666-6666-666666666661';
  v_member uuid := 'ffffffff-ffff-ffff-ffff-ffffffffff11';
  v_loc uuid := 'ffffffff-ffff-ffff-ffff-000000002011';
  v_slot uuid := 'ffffffff-ffff-ffff-ffff-000000002012';
  v_occ_date date := current_date + 21;
  v_dow integer := EXTRACT(ISODOW FROM v_occ_date)::integer;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    v_user,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'schedule-location-conflict@test.local',
    crypt('testpass123', gen_salt('bf')),
    now(),
    now(),
    now()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'Schedule Conflict Org', 'schedule-location-conflict', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed', owner_user_id = EXCLUDED.owner_user_id;

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET license_type = 'lifetime', activated_at = now();

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'Owner Conflict')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone)
  VALUES (v_org, 'Europe/Moscow')
  ON CONFLICT (organization_id) DO UPDATE SET timezone = EXCLUDED.timezone;

  INSERT INTO locations (id, organization_id, name)
  VALUES (v_loc, v_org, 'Hall Conflict')
  ON CONFLICT (id) DO NOTHING;

  DELETE FROM schedule_occurrence_cancellations WHERE organization_id = v_org;
  DELETE FROM schedule_slots WHERE organization_id = v_org;

  -- Retired tombstone: valid_to = valid_from (deleted group slot).
  INSERT INTO schedule_slots (
    id, organization_id, day_of_week, time, time_end, location_id,
    group_name, valid_from, valid_to
  )
  VALUES (
    v_slot, v_org, v_dow, '20:00', '21:00', v_loc,
    'Retired Group', v_occ_date, v_occ_date
  );

  PERFORM _test_assert(
    NOT schedule_location_has_conflict(v_org, v_occ_date, '20:00', '21:00', v_loc),
    'retired group slot must not block schedule_location_has_conflict'
  );

  -- Active slot with cancelled occurrence on that date.
  UPDATE schedule_slots
  SET valid_from = v_occ_date - 7, valid_to = v_occ_date + 90
  WHERE id = v_slot;

  INSERT INTO schedule_occurrence_cancellations (
    organization_id, slot_id, occurrence_date, time, time_end, location_id, group_name, cancelled_by
  )
  VALUES (v_org, v_slot, v_occ_date, '20:00', '21:00', v_loc, 'Retired Group', v_user)
  ON CONFLICT DO NOTHING;

  PERFORM _test_assert(
    NOT schedule_location_has_conflict(v_org, v_occ_date, '20:00', '21:00', v_loc),
    'cancelled group occurrence must not block schedule_location_has_conflict'
  );
END;
$$;

ROLLBACK;
