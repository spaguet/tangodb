-- Google Calendar integration — RLS / credential isolation smoke tests (GCAL Prompt 14)
-- Run: psql $DATABASE_URL -f supabase/tests/google_calendar_security_test.sql

BEGIN;

CREATE OR REPLACE FUNCTION gcal_security_test_assert(p_condition boolean, p_message text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_condition THEN
    RAISE EXCEPTION 'ASSERT FAILED: %', p_message;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION gcal_security_test_set_jwt(
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
  v_org_a uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  v_org_b uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  v_user_a uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_user_b uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  v_member_a uuid := 'cccccccc-cccc-cccc-cccc-cccccccccc01';
  v_member_b uuid := 'dddddddd-dddd-dddd-dddd-dddddddddd01';
  v_google_account_a uuid := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01';
  v_binding_a uuid := 'ffffffff-ffff-ffff-ffff-fffffffffff1';
  v_binding_b uuid := '11111111-1111-1111-1111-111111111101';
  v_link_a uuid := '22222222-2222-2222-2222-222222222201';
  v_outbox_a uuid := '33333333-3333-3333-3333-333333333301';
  v_count int;
  v_caught boolean;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES
    (v_user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gcal-a@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now()),
    (v_user_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gcal-b@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES
    (v_org_a, 'GCAL Org A', 'gcal-org-a', 'licensed', v_version_id, v_user_a),
    (v_org_b, 'GCAL Org B', 'gcal-org-b', 'licensed', v_version_id, v_user_b)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization_members (id, organization_id, user_id, role, is_active)
  VALUES
    (v_member_a, v_org_a, v_user_a, 'owner', true),
    (v_member_b, v_org_b, v_user_b, 'owner', true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone)
  VALUES (v_org_a, 'Europe/Moscow'), (v_org_b, 'Europe/Moscow')
  ON CONFLICT (organization_id) DO NOTHING;

  INSERT INTO user_google_accounts (
    id, user_id, google_subject, google_email, encrypted_refresh_token, granted_scopes, status, token_version
  ) VALUES (
    v_google_account_a, v_user_a, 'gcal-subject-a', 'teacher-a@gmail.com', decode('00', 'hex'), ARRAY['openid'], 'active', 1
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO member_google_calendar_bindings (
    id, organization_id, organization_member_id, google_account_id,
    calendar_id, calendar_name, timezone, enabled, sync_personal, sync_group, sync_events, privacy_mode
  ) VALUES (
    v_binding_a, v_org_a, v_member_a, v_google_account_a,
    'cal-a@google.com', 'TangoDB / A', 'Europe/Moscow', true, true, true, false, 'initials'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO member_google_calendar_bindings (
    id, organization_id, organization_member_id, google_account_id,
    calendar_id, calendar_name, timezone, enabled, sync_personal, sync_group, sync_events, privacy_mode
  ) VALUES (
    v_binding_b, v_org_b, v_member_b, v_google_account_a,
    'cal-b@google.com', 'TangoDB / B', 'Europe/Moscow', true, true, true, false, 'initials'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO google_calendar_event_links (
    id, organization_id, recipient_kind, member_binding_id, source_type, source_id, occurrence_date, sync_status
  ) VALUES (
    v_link_a, v_org_a, 'member', v_binding_a, 'personal_lesson', gen_random_uuid(), CURRENT_DATE + 1, 'synced'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO calendar_sync_outbox (
    id, organization_id, source_type, source_id, occurrence_date, dedupe_key, operation, status
  ) VALUES (
    v_outbox_a, v_org_a, 'personal_lesson', gen_random_uuid(), CURRENT_DATE + 1,
    'personal_lesson:' || gen_random_uuid()::text || ':' || (CURRENT_DATE + 1)::text, 'upsert', 'pending'
  ) ON CONFLICT (id) DO NOTHING;

  -- user_google_accounts: no direct SELECT for authenticated
  PERFORM gcal_security_test_set_jwt(v_user_a, v_org_a, v_member_a, 'owner');
  v_caught := false;
  BEGIN
    SELECT count(*) INTO v_count FROM user_google_accounts;
    PERFORM gcal_security_test_assert(false, 'user_google_accounts should not be readable');
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught := true;
  END;
  PERFORM gcal_security_test_assert(v_caught, 'user_google_accounts must reject authenticated SELECT');

  -- list_my_google_accounts returns only safe fields for current user
  SELECT count(*) INTO v_count
  FROM list_my_google_accounts()
  WHERE google_email = 'teacher-a@gmail.com';
  PERFORM gcal_security_test_assert(v_count = 1, 'list_my_google_accounts should return own account');

  -- Cross-tenant binding isolation
  PERFORM gcal_security_test_set_jwt(v_user_b, v_org_b, v_member_b, 'owner');
  SELECT count(*) INTO v_count
  FROM member_google_calendar_bindings
  WHERE organization_id = v_org_a;
  PERFORM gcal_security_test_assert(v_count = 0, 'other org bindings must not be visible');

  -- Cross-tenant event links
  SELECT count(*) INTO v_count
  FROM google_calendar_event_links
  WHERE id = v_link_a;
  PERFORM gcal_security_test_assert(v_count = 0, 'other org event links must not be visible');

  -- Teacher cannot read org outbox (owner/director only)
  PERFORM gcal_security_test_set_jwt(v_user_a, v_org_a, v_member_a, 'teacher');
  SELECT count(*) INTO v_count FROM calendar_sync_outbox;
  PERFORM gcal_security_test_assert(v_count = 0, 'teacher must not read calendar_sync_outbox');

  -- Owner can read org outbox
  PERFORM gcal_security_test_set_jwt(v_user_a, v_org_a, v_member_a, 'owner');
  SELECT count(*) INTO v_count
  FROM calendar_sync_outbox
  WHERE organization_id = v_org_a;
  PERFORM gcal_security_test_assert(v_count >= 1, 'owner should read own org outbox');

  RAISE NOTICE 'google_calendar_security_test: OK';
END;
$$;

ROLLBACK;
