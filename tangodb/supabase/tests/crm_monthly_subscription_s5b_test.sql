-- S5b: org_created in demo TX, digest enqueue from S4 source, Save chat_id, requeue blocked.
-- Run: npm run test:db:crm-monthly-s5b

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
  v_org uuid;
  v_org_expire uuid := 'c9111111-1111-4111-8111-111111111111';
  v_org_t7 uuid := 'c9222222-2222-4222-8222-222222222222';
  v_as_of timestamptz := timestamptz '2026-09-12 12:00:00+00';
  v_hash text;
  v_result jsonb;
  v_email platform_notification_outbox%ROWTYPE;
  v_tg platform_notification_outbox%ROWTYPE;
  v_id uuid;
  v_id2 uuid;
  v_raised boolean;
  v_n int;
  v_status text;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2' LIMIT 1;

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data
  )
  VALUES (
    v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    's5b-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(),
    '{"platform_role":"developer"}'::jsonb
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        email_confirmed_at = EXCLUDED.email_confirmed_at,
        raw_app_meta_data = EXCLUDED.raw_app_meta_data;

  -- authenticated cannot save settings
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('role', 'authenticated', true);

  v_raised := false;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM save_platform_notification_settings(-100123, v_owner, 'nope');
  EXCEPTION
    WHEN insufficient_privilege THEN v_raised := true;
    WHEN OTHERS THEN v_raised := SQLERRM LIKE '%permission denied%';
  END;
  EXECUTE 'RESET ROLE';
  PERFORM _test_assert(v_raised, 'authenticated must not save notification settings');

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('role', 'service_role', true);

  UPDATE platform_notification_settings
  SET telegram_chat_id = NULL, updated_at = now()
  WHERE id = 1;

  v_hash := owner_email_hash('s5b-owner@test.local');
  v_result := create_self_service_demo_org(v_owner, 'S5b Owner', v_hash, NULL);
  v_org := (v_result ->> 'organization_id')::uuid;
  PERFORM _test_assert(v_org IS NOT NULL, 'self-service demo org created');

  SELECT * INTO v_email
  FROM platform_notification_outbox
  WHERE source_id = v_org AND channel = 'email' AND event_kind = 'org_created';
  SELECT * INTO v_tg
  FROM platform_notification_outbox
  WHERE source_id = v_org AND channel = 'telegram' AND event_kind = 'org_created';

  PERFORM _test_assert(v_email.id IS NOT NULL, 'org_created email outbox');
  PERFORM _test_assert(v_email.status = 'pending', 'org_created email pending');
  PERFORM _test_assert(v_tg.status = 'blocked', 'org_created telegram blocked without chat_id');
  PERFORM _test_assert(v_tg.last_error_code = 'config_missing', 'org_created telegram config_missing');
  PERFORM _test_assert(v_tg.attempts = 0, 'blocked org_created does not burn attempts');
  PERFORM _test_assert(v_email.dedupe_key = 'org_created:' || v_org::text, 'dedupe key org_created:<org_id>');
  PERFORM _test_assert(
    (v_tg.payload ->> 'telegram_text') LIKE '[org_created]%',
    'org_created telegram text'
  );
  PERFORM _test_assert(
    COALESCE(v_tg.payload ->> 'email_domain', '') = 'test.local',
    'org_created payload has email domain not full email'
  );
  PERFORM _test_assert(NOT (v_tg.payload ? 'bot_token'), 'org_created payload has no token');
  PERFORM _test_assert(
    (v_tg.payload ->> 'telegram_text') NOT LIKE '%s5b-owner@test.local%',
    'org_created telegram does not include full email'
  );

  -- retry enqueue does not duplicate
  v_id := (enqueue_platform_org_created_notifications(v_org) ->> 'email_id')::uuid;
  PERFORM _test_assert(v_id = v_email.id, 'retry org_created reuses email row');
  SELECT count(*) INTO v_n
  FROM platform_notification_outbox
  WHERE source_id = v_org AND event_kind = 'org_created';
  PERFORM _test_assert(v_n = 2, 'one email + one telegram for org_created');

  -- Save chat_id
  v_result := save_platform_notification_settings(-100555, v_owner, 'dev group');
  PERFORM _test_assert((v_result ->> 'ok')::boolean, 'save settings ok');
  PERFORM _test_assert(
    (SELECT telegram_chat_id FROM platform_notification_settings WHERE id = 1) = -100555,
    'saved group chat_id'
  );
  PERFORM _test_assert(
    EXISTS (
      SELECT 1 FROM platform_audit_log
      WHERE action = 'platform_bot.settings_save' AND actor_user_id = v_owner
    ),
    'save writes audit'
  );

  v_raised := false;
  BEGIN
    PERFORM save_platform_notification_settings(0, v_owner, NULL);
  EXCEPTION
    WHEN OTHERS THEN v_raised := SQLERRM LIKE '%telegram_chat_id_required%';
  END;
  PERFORM _test_assert(v_raised, 'chat_id 0 rejected');

  -- digest from S4 source
  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES
    (v_org_expire, 'S5b Expire', 's5b-expire', 'licensed', v_version_id, v_owner),
    (v_org_t7, 'S5b TMinus7', 's5b-tminus7', 'licensed', v_version_id, v_owner);

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES
    (v_org_expire, v_version_id, 'subscription', v_as_of - interval '20 days'),
    (v_org_t7, v_version_id, 'subscription', v_as_of - interval '23 days');

  INSERT INTO organization_subscriptions (
    organization_id, plan, billing_period, status, provider,
    current_period_start, current_period_end, billing_anchor_day
  )
  VALUES
    (
      v_org_expire, 'standard', 'monthly', 'active', 'manual',
      v_as_of - interval '30 days', v_as_of, 12
    ),
    (
      v_org_t7, 'standard', 'monthly', 'active', 'manual',
      v_as_of - interval '23 days', v_as_of + interval '3 days', 12
    );

  v_result := enqueue_platform_crm_subscription_digest(v_as_of);
  PERFORM _test_assert((v_result ->> 'ok')::boolean, 'digest enqueue ok');
  PERFORM _test_assert((v_result ->> 'expiring_count')::int = 1, 'digest expiring count');
  PERFORM _test_assert((v_result ->> 'overdue_count')::int = 1, 'digest overdue count');
  PERFORM _test_assert(v_result ->> 'digest_date' = '2026-09-12', 'digest date UTC');

  SELECT count(*) INTO v_n
  FROM platform_notification_outbox
  WHERE event_kind = 'subscription_digest' AND dedupe_key LIKE 'digest:%:2026-09-12';
  PERFORM _test_assert(v_n = 4, 'digest email+telegram for two types');

  SELECT id INTO v_id
  FROM platform_notification_outbox
  WHERE channel = 'email' AND dedupe_key = 'digest:expiring:2026-09-12';
  v_id2 := (enqueue_platform_crm_subscription_digest(v_as_of) ->> 'ok')::text;
  SELECT id INTO v_id2
  FROM platform_notification_outbox
  WHERE channel = 'email' AND dedupe_key = 'digest:expiring:2026-09-12';
  PERFORM _test_assert(v_id = v_id2, 'second digest same day does not duplicate');

  SELECT status INTO v_status
  FROM platform_notification_outbox
  WHERE channel = 'telegram' AND dedupe_key = 'digest:overdue:2026-09-12';
  PERFORM _test_assert(v_status IN ('pending', 'blocked'), 'digest telegram enqueued not inline');

  -- requeue blocked org_created telegram
  SELECT id INTO v_id FROM platform_notification_outbox WHERE id = v_tg.id;
  PERFORM _test_assert(requeue_all_blocked_platform_notifications() >= 1, 'requeue all blocked');
  SELECT status INTO v_status FROM platform_notification_outbox WHERE id = v_tg.id;
  PERFORM _test_assert(v_status = 'pending', 'requeued org_created telegram');

  RAISE NOTICE 'All S5b org_created / digest / save tests passed';
END;
$$;

ROLLBACK;
