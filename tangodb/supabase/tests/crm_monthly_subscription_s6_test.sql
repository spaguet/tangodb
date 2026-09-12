-- S6: support tickets — idempotency, kind guard, close reason, outbox enqueue.
-- Run: npm run test:db:crm-monthly-s6

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
  v_owner uuid := 'c8111111-1111-4111-8111-111111111111';
  v_org uuid := 'c8222222-2222-4222-8222-222222222222';
  v_req uuid := 'c8333333-3333-4333-8333-333333333333';
  v_result jsonb;
  v_ticket uuid;
  v_n int;
  v_raised boolean := false;
  v_dev uuid := 'c8444444-4444-4444-8444-444444444444';
  v_status text;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2' LIMIT 1;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    's6-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    v_dev, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    's6-dev@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id, demo_expires_at, data_purge_at)
  VALUES (v_org, 'S6 Org', 's6-org', 'demo_active', v_version_id, v_owner, now() + interval '7 days', NULL)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization_members (organization_id, user_id, role, is_active)
  VALUES (v_org, v_owner, 'owner', true)
  ON CONFLICT DO NOTHING;

  v_result := submit_platform_support_ticket(
    v_req,
    'login_help',
    'guest@s6.test',
    '@guest',
    'Cannot sign in to my account',
    '/login',
    'en',
    NULL,
    NULL,
    NULL
  );
  PERFORM _test_assert(v_result->>'accepted' = 'true', 'guest login_help accepted');
  v_ticket := (v_result->>'ticket_id')::uuid;

  v_result := submit_platform_support_ticket(
    v_req,
    'login_help',
    'other@s6.test',
    NULL,
    'retry should be idempotent',
    '/login',
    'en',
    NULL,
    NULL,
    NULL
  );
  PERFORM _test_assert(v_result->>'duplicate' = 'true', 'idempotent client_request_id');

  SELECT count(*) INTO v_n
  FROM platform_support_tickets
  WHERE client_request_id = v_req;
  PERFORM _test_assert(v_n = 1, 'single ticket row');

  SELECT count(*) INTO v_n
  FROM platform_notification_outbox
  WHERE source_type = 'support_ticket' AND source_id = v_ticket;
  PERFORM _test_assert(v_n = 2, 'email+telegram outbox rows');

  BEGIN
    PERFORM submit_platform_support_ticket(
      gen_random_uuid(),
      'login_help',
      'bad@s6.test',
      NULL,
      'wrong path',
      '/settings/license',
      'en',
      NULL,
      NULL,
      NULL
    );
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
  END;
  PERFORM _test_assert(v_raised, 'kind_page_mismatch raises');

  v_result := submit_platform_support_ticket(
    gen_random_uuid(),
    'license_help',
    'owner@s6.test',
    NULL,
    'Need help with license renewal',
    '/settings/license',
    'en',
    v_owner,
    v_org,
    'S6 Org'
  );
  PERFORM _test_assert(v_result->>'accepted' = 'true', 'auth license_help');

  v_raised := false;
  BEGIN
    PERFORM dev_console_update_support_ticket(v_ticket, v_dev, 'closed', NULL, NULL);
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
  END;
  PERFORM _test_assert(v_raised, 'close without reason rejected');

  v_result := dev_console_update_support_ticket(v_ticket, v_dev, 'open', NULL, NULL);
  PERFORM _test_assert(v_result->>'ok' = 'true', 'open ticket');

  v_result := dev_console_update_support_ticket(v_ticket, v_dev, 'closed', 'resolved via email', 'contacted user');
  PERFORM _test_assert(v_result->>'ok' = 'true', 'close with reason');

  SELECT status INTO v_status FROM platform_support_tickets WHERE id = v_ticket;
  PERFORM _test_assert(v_status = 'closed', 'ticket closed status');

  PERFORM _test_assert(
    EXISTS (
      SELECT 1 FROM platform_audit_log
      WHERE target_type = 'platform_support_ticket' AND target_id = v_ticket AND action = 'support_ticket.closed'
    ),
    'audit on close'
  );
END;
$$;

ROLLBACK;
