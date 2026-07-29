-- get_conducted_group_lessons_report RPC tests (CRM scenario 4 / Prompt 4)
-- Run: psql $DATABASE_URL -f supabase/tests/conducted_lessons_report_test.sql

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
  v_other_org uuid := 'dddddddd-dddd-dddd-dddd-ddddddddddd1';
  v_user uuid := '66666666-6666-6666-6666-666666666666';
  v_other_user uuid := '66666666-6666-6666-6666-666666666661';
  v_member uuid := 'dddddddd-dddd-dddd-dddd-dddddddddd01';
  v_other_member uuid := 'dddddddd-dddd-dddd-dddd-dddddddddd02';
  v_ballroom uuid := 'dddddddd-dddd-dddd-dddd-000000000101';
  v_tango uuid := 'dddddddd-dddd-dddd-dddd-000000000102';
  v_latin uuid := 'dddddddd-dddd-dddd-dddd-000000000103';
  v_loc uuid := 'dddddddd-dddd-dddd-dddd-000000000201';
  v_class_ballroom uuid := 'dddddddd-dddd-dddd-dddd-000000000301';
  v_class_tango uuid := 'dddddddd-dddd-dddd-dddd-000000000302';
  v_series uuid := 'dddddddd-dddd-dddd-dddd-000000000401';
  v_one_time uuid := 'dddddddd-dddd-dddd-dddd-000000000402';
  v_mon date := date '2026-07-20';
  v_tue date := date '2026-07-21';
  v_wed date := date '2026-07-22';
  v_result jsonb;
  v_rows jsonb;
  v_count integer;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES
    (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conducted-report@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now()),
    (v_other_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conducted-other@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES
    (v_org, 'Conducted Report Org', 'conducted-report', 'licensed', v_version_id, v_user),
    (v_other_org, 'Other Org', 'conducted-other', 'licensed', v_version_id, v_other_user)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES
    (v_member, v_org, v_user, 'owner', 'Teacher One'),
    (v_other_member, v_other_org, v_other_user, 'owner', 'Other Owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone)
  VALUES (v_org, 'Europe/Moscow')
  ON CONFLICT (organization_id) DO UPDATE SET timezone = EXCLUDED.timezone;

  INSERT INTO organization_settings (organization_id)
  VALUES (v_other_org)
  ON CONFLICT (organization_id) DO NOTHING;

  INSERT INTO disciplines (id, organization_id, name, category)
  VALUES
    (v_ballroom, v_org, 'Waltz', 'Ballroom'),
    (v_tango, v_org, 'Tango', 'Ballroom'),
    (v_latin, v_org, 'Salsa', 'Latin')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO locations (id, organization_id, name)
  VALUES (v_loc, v_org, 'Main Hall')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO classes (id, organization_id, name, discipline_id, default_location_id)
  VALUES
    (v_class_ballroom, v_org, 'Ballroom A', v_ballroom, v_loc),
    (v_class_tango, v_org, 'Tango B', v_tango, v_loc)
  ON CONFLICT (id) DO NOTHING;

  DELETE FROM schedule_occurrence_cancellations WHERE organization_id = v_org;
  DELETE FROM attendance WHERE organization_id = v_org;
  DELETE FROM schedule_slots WHERE organization_id = v_org;

  INSERT INTO schedule_slots (
    id, organization_id, day_of_week, time, time_end, discipline_id, group_name,
    location_id, teacher_member_id, class_id, valid_from, valid_to
  )
  VALUES
    (
      v_series, v_org, 1, '19:00', '20:00', v_ballroom, 'Ballroom A', v_loc, v_member, v_class_ballroom,
      date '2026-06-01', NULL
    ),
    (
      v_one_time, v_org, 2, '18:00', '19:00', v_ballroom, 'Ballroom Special', v_loc, v_member, v_class_ballroom,
      v_tue, v_tue
    );

  INSERT INTO attendance (organization_id, date, subscription_id, schedule_group_id, client_display, attendance_status)
  VALUES
    (v_org, v_mon, 'sub-1', v_class_ballroom, 'Client A', 'present'),
    (v_org, v_mon, 'sub-2', v_class_ballroom, 'Client B', 'absent'),
    (v_org, v_mon, 'sub-3', v_class_ballroom, 'Client C', 'freeze');

  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('app.organization_id', v_org::text, true);

  v_result := get_conducted_group_lessons_report(
    '2026-07-20',
    '2026-07-26',
    ARRAY[v_ballroom]::uuid[]
  );

  PERFORM _test_assert((v_result ->> 'success')::boolean, 'owner should fetch report');
  v_rows := v_result -> 'rows';
  v_count := jsonb_array_length(v_rows);
  PERFORM _test_assert(v_count >= 2, 'should include recurring Monday and one-time Tuesday');
  PERFORM _test_assert(
    EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_rows) row
      WHERE row ->> 'date' = '2026-07-20'
        AND (row ->> 'present_count')::integer = 1
        AND (row ->> 'absent_count')::integer = 1
        AND (row ->> 'freeze_count')::integer = 1
    ),
    'attendance aggregates on one lesson row'
  );

  v_result := get_conducted_group_lessons_report(
    '2026-07-20',
    '2026-07-26',
    ARRAY[v_ballroom, v_tango]::uuid[]
  );
  PERFORM _test_assert(
    EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_result -> 'rows') row
      WHERE row ->> 'discipline_name' = 'Tango'
    ) = false,
    'filter excludes tango when not selected'
  );

  UPDATE disciplines SET category = 'Ballroom' WHERE id = v_tango;

  INSERT INTO schedule_slots (
    id, organization_id, day_of_week, time, time_end, discipline_id, group_name,
    location_id, teacher_member_id, class_id, valid_from, valid_to
  )
  VALUES (
    'dddddddd-dddd-dddd-dddd-000000000403', v_org, 3, '19:00', '20:00', v_tango, 'Tango B', v_loc, v_member, v_class_tango,
    date '2026-06-01', NULL
  )
  ON CONFLICT (id) DO NOTHING;

  v_result := get_conducted_group_lessons_report(
    '2026-07-20',
    '2026-07-26',
    ARRAY[v_ballroom]::uuid[]
  );
  PERFORM _test_assert(
    NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_result -> 'rows') row
      WHERE row ->> 'discipline_name' = 'Tango'
    ),
    'ballroom-only filter excludes tango and other categories'
  );

  INSERT INTO schedule_occurrence_cancellations (
    organization_id, slot_id, teacher_member_id, class_id, discipline_id, location_id,
    group_name, occurrence_date, time, time_end
  )
  VALUES (
    v_org, v_series, v_member, v_class_ballroom, v_ballroom, v_loc,
    'Ballroom A', v_mon, '19:00', '20:00'
  );

  v_result := get_conducted_group_lessons_report(
    '2026-07-20',
    '2026-07-26',
    ARRAY[v_ballroom]::uuid[]
  );
  PERFORM _test_assert(
    NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_result -> 'rows') row
      WHERE row ->> 'date' = '2026-07-20'
    ),
    'cancelled occurrence excluded'
  );

  PERFORM set_config('app.organization_id', v_other_org::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_other_user::text, true);

  v_result := get_conducted_group_lessons_report(
    '2026-07-20',
    '2026-07-26',
    ARRAY[v_ballroom]::uuid[]
  );
  PERFORM _test_assert((v_result ->> 'success')::boolean = false, 'other org cannot read report rows');

  PERFORM set_config('app.organization_id', v_org::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  UPDATE organization_members SET role = 'teacher' WHERE id = v_member;
  UPDATE organization_settings SET teachers_can_export = false WHERE organization_id = v_org;

  v_result := get_conducted_group_lessons_report(
    '2026-07-20',
    '2026-07-26',
    ARRAY[v_ballroom]::uuid[]
  );
  PERFORM _test_assert((v_result ->> 'success')::boolean = false, 'teacher without export flag forbidden');

  RAISE NOTICE 'conducted_lessons_report_test: OK';
END;
$$;

ROLLBACK;
