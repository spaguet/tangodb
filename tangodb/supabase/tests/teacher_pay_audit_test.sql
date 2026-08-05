-- Teacher pay audit fixes: dual accrual on closure, finance categories, rule overlap.
-- Run: psql "$DATABASE_URL" -f supabase/tests/teacher_pay_audit_test.sql

BEGIN;

CREATE OR REPLACE FUNCTION _teacher_pay_audit_assert(p_condition boolean, p_message text)
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
  v_org uuid := 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  v_user uuid := 'ffffffff-ffff-4fff-8fff-ffffffff0001';
  v_owner uuid := 'ffffffff-ffff-4fff-8fff-ffffffff0002';
  v_teacher uuid := 'ffffffff-ffff-4fff-8fff-ffffffff0003';
  v_disc uuid := 'ffffffff-ffff-4fff-8fff-ffffffff0101';
  v_loc uuid := 'ffffffff-ffff-4fff-8fff-ffffffff0102';
  v_class uuid := 'ffffffff-ffff-4fff-8fff-ffffffff0103';
  v_slot uuid := 'ffffffff-ffff-4fff-8fff-ffffffff0104';
  v_lesson uuid := 'ffffffff-ffff-4fff-8fff-ffffffff0105';
  v_venue_rule uuid;
  v_pay_rule uuid;
  v_closure_id uuid;
  v_result jsonb;
  v_count integer;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at
  ) VALUES (
    v_user, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'teacher-pay-audit@test.local',
    crypt('testpass123', gen_salt('bf')), now(), now(), now()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'Teacher Pay Audit Org', 'teacher-pay-audit', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES
    (v_owner, v_org, v_user, 'owner', 'Owner Audit'),
    (v_teacher, v_org, v_user, 'teacher', 'Teacher Audit')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO disciplines (id, organization_id, name)
  VALUES (v_disc, v_org, 'Tango Audit')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO locations (id, organization_id, name)
  VALUES (v_loc, v_org, 'Studio Audit')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO classes (id, organization_id, name, discipline_id, default_location_id)
  VALUES (v_class, v_org, 'Audit Group', v_disc, v_loc)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO schedule_slots (
    id, organization_id, class_id, group_name, discipline_id, location_id,
    teacher_member_id, day_of_week, time_start, time_end, valid_from
  ) VALUES (
    v_slot, v_org, v_class, 'Audit Group', v_disc, v_loc, v_teacher,
    1, '19:00', '20:30', '2026-01-01'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO personal_lessons (
    id, organization_id, type, client_id1, date, time_start, time_end,
    teacher_member_id, price, paid, discipline_id, location_id
  ) VALUES (
    v_lesson, v_org, 'solo', NULL, '2026-03-10', '18:00', '19:00',
    v_teacher, 3000, 'yes', v_disc, v_loc
  ) ON CONFLICT (id) DO NOTHING;

  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_user, 'organization_id', v_org, 'member_id', v_owner, 'role', 'owner')::text,
    true
  );
  PERFORM set_active_organization(v_org);

  v_result := save_venue_cost_rule_draft(
    jsonb_build_object(
      'mode', 'per_lesson',
      'valid_from', '2026-03-01',
      'valid_to', '2026-03-31',
      'rules', jsonb_build_object(
        'group', '[]'::jsonb,
        'personal', jsonb_build_array(jsonb_build_object(
          'discipline_id', v_disc,
          'location_id', v_loc,
          'amount', 500
        ))
      )
    ),
    gen_random_uuid()
  );
  PERFORM _teacher_pay_audit_assert((v_result ->> 'success')::boolean, 'venue rule draft saves');
  v_venue_rule := (v_result ->> 'rule_version_id')::uuid;
  PERFORM accept_venue_cost_rule_version(v_venue_rule, gen_random_uuid());

  v_result := save_teacher_pay_rule(
    jsonb_build_object(
      'member_id', v_teacher,
      'lesson_kind', 'personal',
      'discipline_id', v_disc,
      'amount_type', 'percent',
      'value', 30,
      'expense_category', 'rent',
      'valid_from', '2026-03-01'
    ),
    gen_random_uuid()
  );
  PERFORM _teacher_pay_audit_assert((v_result ->> 'success')::boolean, 'teacher pay rule saves');
  v_pay_rule := (v_result ->> 'rule_id')::uuid;

  v_result := close_personal_lesson_occurrence(v_lesson, gen_random_uuid());
  PERFORM _teacher_pay_audit_assert((v_result ->> 'success')::boolean, 'personal closure closes');
  v_closure_id := (v_result ->> 'closure_id')::uuid;

  SELECT count(*) INTO v_count
  FROM venue_cost_accruals
  WHERE organization_id = v_org
    AND closure_id = v_closure_id
    AND accrual_status = 'posted'
    AND accrual_kind = 'lesson';
  PERFORM _teacher_pay_audit_assert(v_count = 2, 'closure posts venue cost and teacher deduction');

  SELECT count(*) INTO v_count
  FROM finance_cost_entries_v
  WHERE organization_id = v_org
    AND closure_id = v_closure_id
    AND source_type = 'venue_cost';
  PERFORM _teacher_pay_audit_assert(v_count = 1, 'venue cost appears in finance view');

  SELECT count(*) INTO v_count
  FROM finance_cost_entries_v
  WHERE organization_id = v_org
    AND closure_id = v_closure_id
    AND source_type = 'teacher_expense'
    AND teacher_pay_rule_id = v_pay_rule;
  PERFORM _teacher_pay_audit_assert(v_count = 1, 'categorized teacher deduction appears in finance view');

  v_result := save_teacher_pay_rule(
    jsonb_build_object(
      'member_id', v_teacher,
      'lesson_kind', 'all',
      'amount_type', 'percent',
      'value', 20,
      'valid_from', '2026-03-15'
    ),
    gen_random_uuid()
  );
  PERFORM _teacher_pay_audit_assert(v_result ->> 'error_code' = 'rule_overlap', 'all vs specific overlap rejected');

  v_result := reopen_lesson_occurrence_closure(v_closure_id, 'audit reopen', gen_random_uuid());
  PERFORM _teacher_pay_audit_assert((v_result ->> 'success')::boolean, 'reopen succeeds');
  SELECT count(*) INTO v_count
  FROM venue_cost_accruals
  WHERE organization_id = v_org
    AND closure_id = v_closure_id
    AND accrual_status = 'posted'
    AND accrual_kind = 'adjustment';
  PERFORM _teacher_pay_audit_assert(v_count = 2, 'reopen reverses venue and teacher accruals');
END $$;

ROLLBACK;
