-- PERSONAL_LESSONS Stage 1 smoke tests (attendance package, excused, delete/update guards)
-- Run: psql $DATABASE_URL -f supabase/tests/personal_lessons_stage1_test.sql

BEGIN;

CREATE OR REPLACE FUNCTION pl_stage1_test_assert(p_condition boolean, p_message text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_condition THEN
    RAISE EXCEPTION 'ASSERT FAILED: %', p_message;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pl_stage1_test_set_jwt(
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
  v_org uuid := 'c1111111-1111-4111-8111-111111111111';
  v_user uuid := 'c2222222-2222-4222-8222-222222222222';
  v_member uuid := 'c3333333-3333-4333-8333-333333333333';
  v_client1 uuid := 'c4444444-4444-4444-8444-444444444444';
  v_client2 uuid := 'c5555555-5555-4555-8555-555555555555';
  v_client3 uuid := 'c6666666-6666-4666-8666-666666666666';
  v_client4 uuid := 'c7777777-7777-4777-8777-777777777777';
  v_disc uuid := 'c8888888-8888-4888-8888-888888888888';
  v_loc uuid := 'c9999999-9999-4999-8999-999999999999';
  v_sub uuid := 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_lesson_past uuid := 'cbaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_lesson_future uuid := 'cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  v_result jsonb;
  v_left int;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2' LIMIT 1;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pl-stage1@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'PL Stage1 Org', 'pl-stage1-org', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization_members (id, organization_id, user_id, role, status)
  VALUES (v_member, v_org, v_user, 'owner', 'active')
  ON CONFLICT DO NOTHING;

  INSERT INTO organization_settings (organization_id)
  VALUES (v_org)
  ON CONFLICT (organization_id) DO NOTHING;

  INSERT INTO clients (id, organization_id, first_name, last_name)
  VALUES
    (v_client1, v_org, 'A', 'One'),
    (v_client2, v_org, 'B', 'Two'),
    (v_client3, v_org, 'C', 'Three'),
    (v_client4, v_org, 'D', 'Four')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO disciplines (id, organization_id, name)
  VALUES (v_disc, v_org, 'Tango')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO locations (id, organization_id, name)
  VALUES (v_loc, v_org, 'Studio')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO subscriptions (
    id, organization_id, type, client_id1, client_id2, client_id3, client_id4,
    lessons_total, lessons_left, activation_date, status, category, discipline_id
  )
  VALUES (
    v_sub, v_org, 'quad', v_client1, v_client2, v_client3, v_client4,
    5, 5, current_date - 30, 'active', 'private', v_disc
  )
  ON CONFLICT (id) DO UPDATE SET lessons_left = 5, status = 'active';

  INSERT INTO personal_lessons (
    id, organization_id, type, client_id1, client_id2, client_id3, client_id4,
    date, discipline_id, location_id, subscription_id, paid
  )
  VALUES (
    v_lesson_past, v_org, 'quad', v_client1, v_client2, v_client3, v_client4,
    current_date - 1, v_disc, v_loc, v_sub, 'yes'
  )
  ON CONFLICT (id) DO UPDATE SET
    date = current_date - 1,
    subscription_id = v_sub,
    attendance_status = NULL,
    paid = 'yes';

  INSERT INTO personal_lessons (
    id, organization_id, type, client_id1, date, discipline_id, location_id, paid, price
  )
  VALUES (
    v_lesson_future, v_org, 'solo', v_client1, current_date + 7, v_disc, v_loc, 'no', 1000
  )
  ON CONFLICT (id) DO UPDATE SET date = current_date + 7;

  PERFORM pl_stage1_test_set_jwt(v_user, v_org, v_member, 'owner');

  -- Package attendance: present deducts
  v_result := mark_personal_lesson_attendance(v_lesson_past::text, 'present');
  PERFORM pl_stage1_test_assert((v_result ->> 'success')::boolean, 'mark present ok');
  PERFORM pl_stage1_test_assert((v_result ->> 'newLessonsLeft')::int = 4, 'present deducts 1 lesson');

  SELECT lessons_left INTO v_left FROM subscriptions WHERE id = v_sub;
  PERFORM pl_stage1_test_assert(v_left = 4, 'subscription lessons_left = 4');

  -- present -> excused refunds
  v_result := mark_personal_lesson_attendance(v_lesson_past::text, 'excused');
  PERFORM pl_stage1_test_assert((v_result ->> 'success')::boolean, 'mark excused ok');
  PERFORM pl_stage1_test_assert((v_result ->> 'newLessonsLeft')::int = 5, 'excused refunds lesson');

  -- excused -> absent deducts again
  v_result := mark_personal_lesson_attendance(v_lesson_past::text, 'absent');
  PERFORM pl_stage1_test_assert((v_result ->> 'success')::boolean, 'mark absent ok');
  PERFORM pl_stage1_test_assert((v_result ->> 'newLessonsLeft')::int = 4, 'absent deducts after excused');

  -- Reset for delete test
  UPDATE personal_lessons SET attendance_status = NULL WHERE id = v_lesson_past;
  UPDATE subscriptions SET lessons_left = 5 WHERE id = v_sub;

  -- delete: future ok
  v_result := delete_personal_lesson(v_lesson_future::text);
  PERFORM pl_stage1_test_assert((v_result ->> 'success')::boolean, 'delete future lesson ok');

  -- delete: today rejected
  UPDATE personal_lessons SET date = current_date WHERE id = v_lesson_past;
  v_result := delete_personal_lesson(v_lesson_past::text);
  PERFORM pl_stage1_test_assert(NOT (v_result ->> 'success')::boolean, 'delete today rejected');

  -- update: today rejected
  v_result := update_personal_lesson(v_lesson_past::text, jsonb_build_object('time_start', '15:00'));
  PERFORM pl_stage1_test_assert(NOT (v_result ->> 'success')::boolean, 'update today rejected');

  RAISE NOTICE 'personal_lessons_stage1_test: all assertions passed';
END;
$$;

ROLLBACK;
