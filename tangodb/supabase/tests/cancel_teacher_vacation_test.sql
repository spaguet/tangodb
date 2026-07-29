-- cancel_teacher_group_vacation and cancellation log tests
-- Run: psql $DATABASE_URL -f supabase/tests/cancel_teacher_vacation_test.sql

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
  v_member uuid := 'ffffffff-ffff-ffff-ffff-ffffffffff01';
  v_disc uuid := 'ffffffff-ffff-ffff-ffff-000000000101';
  v_loc uuid := 'ffffffff-ffff-ffff-ffff-000000000201';
  v_class uuid := 'ffffffff-ffff-ffff-ffff-000000000301';
  v_series_a uuid := 'ffffffff-ffff-ffff-ffff-000000000401';
  v_series_b uuid := 'ffffffff-ffff-ffff-ffff-000000000402';
  v_wed1 date := date '2026-07-01';
  v_wed2 date := date '2026-07-08';
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
    'teacher-vacation@test.local',
    crypt('testpass123', gen_salt('bf')),
    now(),
    now(),
    now()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'Teacher Vacation Org', 'teacher-vacation', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'Owner Vacation')
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
  VALUES
    (
      v_series_a, v_org, 3, '20:00', '21:00', v_disc, 'Group A', v_loc, v_member, v_class,
      date '2026-06-01', NULL
    ),
    (
      v_series_b, v_org, 3, '18:00', '19:00', v_disc, 'Group B', v_loc, v_member, v_class,
      date '2026-06-01', NULL
    )
  ON CONFLICT (id) DO NOTHING;

  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user::text)::text, true);

  UPDATE organization_members
  SET organization_id = v_org
  WHERE id = v_member;

  v_result := cancel_teacher_group_vacation(
    v_member,
    v_wed1::text,
    v_wed2::text
  );

  PERFORM _test_assert((v_result ->> 'success')::boolean, 'Teacher vacation should succeed');
  PERFORM _test_assert((v_result ->> 'cancelled_count')::integer = 4, 'Should cancel 2 dates x 2 groups');
  PERFORM _test_assert((v_result ->> 'series_count')::integer = 2, 'Should touch 2 series');

  SELECT count(*) INTO v_count
  FROM schedule_occurrence_cancellations
  WHERE organization_id = v_org
    AND occurrence_date BETWEEN v_wed1 AND v_wed2;

  PERFORM _test_assert(v_count = 4, 'Cancellation log should contain 4 rows');

  PERFORM _test_assert(
    NOT EXISTS (
      SELECT 1
      FROM schedule_slots s
      WHERE s.organization_id = v_org
        AND s.valid_from <= v_wed1
        AND (s.valid_to IS NULL OR s.valid_to >= v_wed1)
    ),
    'Vacation dates should be excluded from all series'
  );

  RAISE NOTICE 'All cancel_teacher_group_vacation tests passed.';
END;
$$;

ROLLBACK;
