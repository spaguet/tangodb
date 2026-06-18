-- TangoDB v2 Phase 2B — business RLS + mark_attendance smoke tests
-- Run: psql $DATABASE_URL -f supabase/tests/v2_business_rls_test.sql

BEGIN;

CREATE OR REPLACE FUNCTION v2_business_rls_test_assert(p_condition boolean, p_message text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_condition THEN
    RAISE EXCEPTION 'ASSERT FAILED: %', p_message;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION v2_business_rls_test_set_jwt(
  p_user_id uuid,
  p_org_id uuid,
  p_member_id uuid,
  p_role text
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', p_user_id::text,
      'organization_id', p_org_id::text,
      'member_id', p_member_id::text,
      'role', p_role
    )::text,
    true
  );
END;
$$;

DO $$
DECLARE
  v_version_id uuid;
  v_org uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_user_owner uuid := '11111111-1111-1111-1111-111111111111';
  v_user_teacher_a uuid := '22222222-2222-2222-2222-222222222222';
  v_user_teacher_b uuid := '33333333-3333-3333-3333-333333333333';
  v_user_accountant uuid := '44444444-4444-4444-4444-444444444444';
  v_user_outsider uuid := '55555555-5555-5555-5555-555555555555';
  v_member_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01';
  v_member_teacher_a uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02';
  v_member_teacher_b uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03';
  v_member_accountant uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa04';
  v_org_b uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  v_member_b uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01';
  v_user_b uuid := '66666666-6666-6666-6666-666666666666';
  v_client uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001';
  v_disc_a uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000101';
  v_disc_b uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000102';
  v_sub_a uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000201';
  v_sub_b uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000202';
  v_count int;
  v_result jsonb;
  v_caught boolean;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES
    (v_user_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now()),
    (v_user_teacher_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-ta@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now()),
    (v_user_teacher_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-tb@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now()),
    (v_user_accountant, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-acc@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now()),
    (v_user_outsider, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-out@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now()),
    (v_user_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-b@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES
    (v_org, 'RLS Org', 'rls-org', 'licensed', v_version_id, v_user_owner),
    (v_org_b, 'RLS Org B', 'rls-org-b', 'licensed', v_version_id, v_user_b)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name, scope)
  VALUES
    (v_member_owner, v_org, v_user_owner, 'owner', 'Owner', '{}'),
    (
      v_member_teacher_a, v_org, v_user_teacher_a, 'teacher', 'Teacher A',
      jsonb_build_object(
        'discipline_ids', jsonb_build_array(v_disc_a::text),
        'location_ids', '[]'::jsonb,
        'all_disciplines', false,
        'all_locations', false,
        'can_view_all_clients', false
      )
    ),
    (
      v_member_teacher_b, v_org, v_user_teacher_b, 'teacher', 'Teacher B',
      jsonb_build_object(
        'discipline_ids', jsonb_build_array(v_disc_b::text),
        'location_ids', '[]'::jsonb,
        'all_disciplines', false,
        'all_locations', false,
        'can_view_all_clients', false
      )
    ),
    (v_member_accountant, v_org, v_user_accountant, 'accountant', 'Accountant', '{}'),
    (v_member_b, v_org_b, v_user_b, 'owner', 'Owner B', '{}')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, freeze_max_count, freeze_min_lessons, freeze_deducts_lesson)
  VALUES (v_org, 2, 4, true), (v_org_b, 1, 8, true)
  ON CONFLICT (organization_id) DO UPDATE
    SET freeze_max_count = EXCLUDED.freeze_max_count,
        freeze_min_lessons = EXCLUDED.freeze_min_lessons,
        freeze_deducts_lesson = EXCLUDED.freeze_deducts_lesson;

  INSERT INTO user_active_organizations (user_id, organization_id, member_id)
  VALUES
    (v_user_owner, v_org, v_member_owner),
    (v_user_teacher_a, v_org, v_member_teacher_a),
    (v_user_teacher_b, v_org, v_member_teacher_b),
    (v_user_accountant, v_org, v_member_accountant),
    (v_user_b, v_org_b, v_member_b)
  ON CONFLICT (user_id) DO UPDATE
    SET organization_id = EXCLUDED.organization_id,
        member_id = EXCLUDED.member_id;

  INSERT INTO clients (id, organization_id, first_name, last_name)
  VALUES (v_client, v_org, 'Test', 'Client')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO disciplines (id, organization_id, name)
  VALUES
    (v_disc_a, v_org, 'Tango'),
    (v_disc_b, v_org, 'Salsa')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO subscriptions (
    id, organization_id, type, client_id1, lessons_total, lessons_left,
    activation_date, discipline_id, category, freeze_used
  )
  VALUES
    (v_sub_a, v_org, 'solo', v_client, 4, 4, CURRENT_DATE, v_disc_a, 'group', 0),
    (v_sub_b, v_org, 'solo', v_client, 4, 4, CURRENT_DATE, v_disc_b, 'group', 0)
  ON CONFLICT (id) DO NOTHING;

  -- Cross-tenant: Org B owner cannot read Org A subscriptions
  PERFORM v2_business_rls_test_set_jwt(v_user_b, v_org_b, v_member_b, 'owner');

  SELECT count(*) INTO v_count
  FROM subscriptions
  WHERE id = v_sub_a;

  PERFORM v2_business_rls_test_assert(v_count = 0, 'Cross-tenant subscription read must return 0 rows');

  -- Teacher A sees only Tango subscription
  PERFORM v2_business_rls_test_set_jwt(v_user_teacher_a, v_org, v_member_teacher_a, 'teacher');

  SELECT count(*) INTO v_count FROM subscriptions WHERE id = v_sub_a;
  PERFORM v2_business_rls_test_assert(v_count = 1, 'Teacher A must see discipline A subscription');

  SELECT count(*) INTO v_count FROM subscriptions WHERE id = v_sub_b;
  PERFORM v2_business_rls_test_assert(v_count = 0, 'Teacher A must not see discipline B subscription');

  PERFORM v2_business_rls_test_assert(
    teacher_has_discipline_access(v_disc_a),
    'teacher_has_discipline_access true for scoped discipline'
  );
  PERFORM v2_business_rls_test_assert(
    NOT teacher_has_discipline_access(v_disc_b),
    'teacher_has_discipline_access false outside scope'
  );

  -- Accountant read ok, write denied
  PERFORM v2_business_rls_test_set_jwt(v_user_accountant, v_org, v_member_accountant, 'accountant');

  SELECT count(*) INTO v_count FROM clients WHERE id = v_client;
  PERFORM v2_business_rls_test_assert(v_count = 1, 'Accountant must read clients');

  v_caught := false;
  BEGIN
    INSERT INTO clients (organization_id, first_name, last_name)
    VALUES (v_org, 'Blocked', 'Client');
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_caught := true;
    WHEN OTHERS THEN
      IF SQLERRM LIKE '%violates row-level security%' OR SQLERRM LIKE '%permission denied%' THEN
        v_caught := true;
      ELSE
        RAISE;
      END IF;
  END;
  PERFORM v2_business_rls_test_assert(v_caught, 'Accountant INSERT client must be denied');

  -- Direct subscription counter UPDATE blocked
  PERFORM v2_business_rls_test_set_jwt(v_user_owner, v_org, v_member_owner, 'owner');

  v_caught := false;
  BEGIN
    UPDATE subscriptions SET lessons_left = 1 WHERE id = v_sub_a;
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE '%Direct update of subscription counters%' THEN
        v_caught := true;
      ELSE
        RAISE;
      END IF;
  END;
  PERFORM v2_business_rls_test_assert(v_caught, 'Direct lessons_left UPDATE must be blocked');

  -- mark_attendance respects freeze_min_lessons from settings (4 lessons ok)
  PERFORM v2_business_rls_test_set_jwt(v_user_teacher_a, v_org, v_member_teacher_a, 'teacher');

  v_result := mark_attendance(to_char(CURRENT_DATE, 'YYYY-MM-DD'), v_sub_a::text, 'freeze');
  PERFORM v2_business_rls_test_assert(
    COALESCE((v_result ->> 'success')::boolean, false),
    'mark_attendance freeze must succeed for 4-lesson sub with freeze_min_lessons=4'
  );

  -- Second freeze exceeds freeze_max_count=2 after first
  v_result := mark_attendance(to_char(CURRENT_DATE - 1, 'YYYY-MM-DD'), v_sub_a::text, 'freeze');
  PERFORM v2_business_rls_test_assert(
    COALESCE((v_result ->> 'success')::boolean, false),
    'mark_attendance second freeze day should succeed'
  );

  v_result := mark_attendance(to_char(CURRENT_DATE - 2, 'YYYY-MM-DD'), v_sub_a::text, 'freeze');
  PERFORM v2_business_rls_test_assert(
    NOT COALESCE((v_result ->> 'success')::boolean, true),
    'mark_attendance third freeze must fail when freeze_max_count=2'
  );

  -- Teacher B cannot mark attendance on discipline A subscription
  PERFORM v2_business_rls_test_set_jwt(v_user_teacher_b, v_org, v_member_teacher_b, 'teacher');

  v_result := mark_attendance(to_char(CURRENT_DATE, 'YYYY-MM-DD'), v_sub_a::text, 'present');
  PERFORM v2_business_rls_test_assert(
    NOT COALESCE((v_result ->> 'success')::boolean, true),
    'Teacher B mark_attendance on discipline A must fail'
  );

  RAISE NOTICE 'All v2 business RLS tests passed.';
END;
$$;

ROLLBACK;
