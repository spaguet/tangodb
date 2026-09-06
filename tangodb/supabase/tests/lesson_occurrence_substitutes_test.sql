-- Lesson occurrence substitutes: assign/clear, date-scoped access, payroll.
-- Run: psql "%DATABASE_URL%" -f supabase/tests/lesson_occurrence_substitutes_test.sql

BEGIN;

CREATE OR REPLACE FUNCTION _sub_assert(p_condition boolean, p_message text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT COALESCE(p_condition, false) THEN
    RAISE EXCEPTION 'ASSERT FAILED: %', p_message;
  END IF;
END;
$$;

DO $$
DECLARE
  v_version_id uuid;
  v_org uuid := 'a2110200-0000-4000-8000-000000000001';
  v_owner_user uuid := 'a2110200-0000-4000-8000-000000000002';
  v_t1_user uuid := 'a2110200-0000-4000-8000-000000000003';
  v_t2_user uuid := 'a2110200-0000-4000-8000-000000000004';
  v_owner uuid := 'a2110200-0000-4000-8000-000000000011';
  v_t1 uuid := 'a2110200-0000-4000-8000-000000000012';
  v_t2 uuid := 'a2110200-0000-4000-8000-000000000013';
  v_disc uuid := 'a2110200-0000-4000-8000-000000000101';
  v_loc uuid := 'a2110200-0000-4000-8000-000000000201';
  v_class uuid := 'a2110200-0000-4000-8000-000000000301';
  v_slot uuid := 'a2110200-0000-4000-8000-000000000401';
  v_personal uuid := 'a2110200-0000-4000-8000-000000000501';
  v_overlap_personal uuid := 'a2110200-0000-4000-8000-000000000502';
  v_wed date := date '2026-09-02';
  v_other_wed date := date '2026-08-26';
  v_result jsonb;
  v_conducting uuid;
  v_count integer;
  v_accrued_t1 numeric;
  v_accrued_t2 numeric;
  v_t2_scope jsonb := jsonb_build_object(
    'discipline_ids', '[]'::jsonb,
    'location_ids', '[]'::jsonb,
    'schedule_group_ids', '[]'::jsonb,
    'all_disciplines', true,
    'all_locations', true,
    'all_groups', false,
    'can_view_all_clients', false
  );
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at
  ) VALUES
    (v_owner_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sub-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now()),
    (v_t1_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sub-t1@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now()),
    (v_t2_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'sub-t2@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'Substitute Org', 'lesson-substitute', 'licensed', v_version_id, v_owner_user)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name, is_active)
  VALUES
    (v_owner, v_org, v_owner_user, 'owner', 'Owner Sub', true),
    (v_t1, v_org, v_t1_user, 'teacher', 'Teacher One', true),
    (v_t2, v_org, v_t2_user, 'teacher', 'Teacher Two', true)
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  UPDATE organization_members
  SET scope = v_t2_scope
  WHERE id = v_t2 AND organization_id = v_org;

  INSERT INTO organization_settings (organization_id)
  VALUES (v_org)
  ON CONFLICT (organization_id) DO NOTHING;

  INSERT INTO disciplines (id, organization_id, name)
  VALUES (v_disc, v_org, 'Ballroom')
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
    v_slot, v_org, 3, '19:00', '20:00', v_disc, 'Group A', v_loc, v_t1, v_class,
    date '2026-06-01', NULL
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO personal_lessons (
    id, organization_id, type, client_id1, date, time_start, time_end,
    teacher_member_id, price, paid, discipline_id, location_id
  ) VALUES (
    v_personal, v_org, 'solo', NULL, v_wed, '18:00', '19:00',
    v_t1, 2000, 'yes', v_disc, v_loc
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO teacher_pay_rates (
    organization_id, member_id, pay_mode, fixed_amount,
    rate_percent, group_rate_percent, personal_rate_percent, single_visit_rate_percent,
    effective_from
  ) VALUES
    (v_org, v_t1, 'percent', 0, 40, 40, 40, 40, date '2026-01-01'),
    (v_org, v_t2, 'percent', 0, 50, 50, 50, 50, date '2026-01-01');

  -- Owner JWT
  PERFORM set_config('request.jwt.claim.sub', v_owner_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', v_owner_user,
      'role', 'authenticated',
      'organization_id', v_org,
      'member_id', v_owner
    )::text,
    true
  );
  PERFORM set_active_organization(v_org);

  -- Teacher 2 cannot mark Group A before substitute
  PERFORM set_config('request.jwt.claim.sub', v_t2_user::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', v_t2_user,
      'role', 'authenticated',
      'organization_id', v_org,
      'member_id', v_t2
    )::text,
    true
  );
  PERFORM set_active_organization(v_org);

  PERFORM _sub_assert(
    NOT teacher_can_mark_group_attendance(v_wed, v_class),
    'Teacher 2 must not mark Group A before substitute'
  );

  -- Teacher 2 cannot assign (not the regular teacher)
  v_result := assign_lesson_substitute('group', v_wed, v_slot, NULL, v_t2, gen_random_uuid());
  PERFORM _sub_assert(
    NOT COALESCE((v_result ->> 'success')::boolean, false),
    'Teacher 2 must not assign themselves as substitute'
  );

  -- Regular teacher (T1) can assign T2
  PERFORM set_config('request.jwt.claim.sub', v_t1_user::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', v_t1_user,
      'role', 'authenticated',
      'organization_id', v_org,
      'member_id', v_t1
    )::text,
    true
  );
  PERFORM set_active_organization(v_org);

  v_result := assign_lesson_substitute('group', v_wed, v_slot, NULL, v_t2, gen_random_uuid());
  PERFORM _sub_assert((v_result ->> 'success')::boolean, 'T1 assign T2 should succeed: ' || COALESCE(v_result ->> 'error', ''));
  PERFORM _sub_assert(
    (v_result ->> 'substitute_teacher_member_id')::uuid = v_t2,
    'Assigned substitute is T2'
  );

  SELECT occurrence_conducting_teacher_id(v_org, 'group', v_slot, NULL, v_wed, v_t1)
  INTO v_conducting;
  PERFORM _sub_assert(v_conducting = v_t2, 'Conducting teacher is T2');

  SELECT teacher_member_id INTO v_conducting FROM schedule_slots WHERE id = v_slot;
  PERFORM _sub_assert(v_conducting = v_t1, 'Slot teacher stays T1');

  -- Overlap: T2 already conducts Group A 19:00; personal at same time must fail
  INSERT INTO personal_lessons (
    id, organization_id, type, client_id1, date, time_start, time_end,
    teacher_member_id, price, paid, discipline_id, location_id
  ) VALUES (
    v_overlap_personal, v_org, 'solo', NULL, v_wed, '19:00', '20:00',
    v_t1, 1000, 'yes', v_disc, v_loc
  )
  ON CONFLICT (id) DO NOTHING;

  v_result := assign_lesson_substitute(
    'personal', v_wed, NULL, v_overlap_personal, v_t2, gen_random_uuid()
  );
  PERFORM _sub_assert(
    NOT COALESCE((v_result ->> 'success')::boolean, false),
    'Overlap must block substitute'
  );
  PERFORM _sub_assert(
    COALESCE(v_result ->> 'error', '') = 'schedule.substitute.error.overlap',
    'Overlap error key'
  );

  -- Teacher 2 can mark that date only
  PERFORM set_config('request.jwt.claim.sub', v_t2_user::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', v_t2_user,
      'role', 'authenticated',
      'organization_id', v_org,
      'member_id', v_t2
    )::text,
    true
  );
  PERFORM set_active_organization(v_org);

  PERFORM _sub_assert(
    teacher_can_mark_group_attendance(v_wed, v_class),
    'Teacher 2 can mark Group A on substitute date'
  );
  PERFORM _sub_assert(
    NOT teacher_can_mark_group_attendance(v_other_wed, v_class),
    'Teacher 2 cannot mark Group A on other dates'
  );

  -- Owner assigns personal substitute
  PERFORM set_config('request.jwt.claim.sub', v_owner_user::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', v_owner_user,
      'role', 'authenticated',
      'organization_id', v_org,
      'member_id', v_owner
    )::text,
    true
  );
  PERFORM set_active_organization(v_org);

  v_result := assign_lesson_substitute(
    'personal', v_wed, NULL, v_personal, v_t2, gen_random_uuid()
  );
  PERFORM _sub_assert((v_result ->> 'success')::boolean, 'Owner personal substitute: ' || COALESCE(v_result ->> 'error', ''));

  PERFORM _sub_assert(
    teacher_is_personal_occurrence_substitute(v_personal) = false,
    'Owner JWT is not the substitute'
  );

  PERFORM set_config('request.jwt.claim.sub', v_t2_user::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', v_t2_user,
      'role', 'authenticated',
      'organization_id', v_org,
      'member_id', v_t2
    )::text,
    true
  );
  PERFORM set_active_organization(v_org);
  PERFORM _sub_assert(
    teacher_can_mark_personal_lesson(v_personal),
    'T2 can mark substituted personal lesson'
  );

  -- Payroll: T2 earns the personal lesson, T1 does not
  PERFORM set_config('request.jwt.claim.sub', v_owner_user::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', v_owner_user,
      'role', 'authenticated',
      'organization_id', v_org,
      'member_id', v_owner
    )::text,
    true
  );
  PERFORM set_active_organization(v_org);

  PERFORM recalculate_teacher_settlement(
    v_org,
    EXTRACT(YEAR FROM v_wed)::int,
    EXTRACT(MONTH FROM v_wed)::int
  );

  SELECT COALESCE(amount_accrued, 0) INTO v_accrued_t1
  FROM teacher_settlements
  WHERE organization_id = v_org
    AND member_id = v_t1
    AND period_year = EXTRACT(YEAR FROM v_wed)::int
    AND period_month = EXTRACT(MONTH FROM v_wed)::int;

  SELECT COALESCE(amount_accrued, 0) INTO v_accrued_t2
  FROM teacher_settlements
  WHERE organization_id = v_org
    AND member_id = v_t2
    AND period_year = EXTRACT(YEAR FROM v_wed)::int
    AND period_month = EXTRACT(MONTH FROM v_wed)::int;

  SELECT count(*) INTO v_count
  FROM teacher_settlement_line_items
  WHERE organization_id = v_org
    AND member_id = v_t2
    AND source_type = 'occurrence'
    AND line_category = 'personal'
    AND line_date = v_wed;

  PERFORM _sub_assert(v_count >= 1, 'T2 settlement has personal substitute line');
  PERFORM _sub_assert(v_accrued_t2 >= 1000, 'T2 accrued at least 50% of 2000');

  SELECT count(*) INTO v_count
  FROM teacher_settlement_line_items
  WHERE organization_id = v_org
    AND member_id = v_t1
    AND source_type = 'occurrence'
    AND line_category = 'personal'
    AND line_date = v_wed;

  PERFORM _sub_assert(v_count = 0, 'T1 does not earn substituted personal lesson');

  -- Slot teacher unchanged after payroll
  SELECT teacher_member_id INTO v_conducting FROM schedule_slots WHERE id = v_slot;
  PERFORM _sub_assert(v_conducting = v_t1, 'Slot teacher still T1 after payroll');
END;
$$;

ROLLBACK;
