-- S5a: platform notification outbox — dedupe, lease, blocked, requeue, dead;
-- purchase submit enqueues email+telegram; telegram config_missing does not roll back the request.
-- Run: npm run test:db:crm-monthly-s5a

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
  v_owner uuid := 'c7111111-1111-4111-8111-111111111111';
  v_org uuid := 'c7222222-2222-4222-8222-222222222222';
  v_quote_id uuid;
  v_quote_id2 uuid;
  v_now timestamptz := now();
  v_result jsonb;
  v_req_id uuid;
  v_email platform_notification_outbox%ROWTYPE;
  v_tg platform_notification_outbox%ROWTYPE;
  v_claimed platform_notification_outbox%ROWTYPE;
  v_claimed2 platform_notification_outbox%ROWTYPE;
  v_n int;
  v_id uuid;
  v_id2 uuid;
  v_token uuid;
  v_raised boolean;
  v_attempts int;
  v_status text;
  v_req_alive uuid;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2' LIMIT 1;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES (
    v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    's5a-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id, demo_expires_at, data_purge_at)
  VALUES (
    v_org, 'S5a Demo', 's5a-demo', 'demo_active', v_version_id, v_owner,
    v_now + interval '5 days', v_now + interval '5 days'
  )
  ON CONFLICT (id) DO NOTHING;

  -- authenticated cannot read/write settings or outbox
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('role', 'authenticated', true);

  v_raised := false;
  BEGIN
    INSERT INTO platform_notification_settings (id, telegram_chat_id)
    VALUES (1, 123)
    ON CONFLICT (id) DO UPDATE SET telegram_chat_id = 123;
  EXCEPTION
    WHEN insufficient_privilege THEN v_raised := true;
    WHEN OTHERS THEN v_raised := SQLERRM LIKE '%permission denied%';
  END;
  PERFORM _test_assert(v_raised, 'authenticated must not write notification settings');

  v_raised := false;
  BEGIN
    INSERT INTO platform_notification_outbox (
      channel, event_kind, source_type, dedupe_key, payload
    ) VALUES ('email', 'x', 'x', 'auth-denied', '{}'::jsonb);
  EXCEPTION
    WHEN insufficient_privilege THEN v_raised := true;
    WHEN OTHERS THEN v_raised := SQLERRM LIKE '%permission denied%';
  END;
  PERFORM _test_assert(v_raised, 'authenticated must not insert outbox');

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('role', 'service_role', true);

  -- no chat_id: submit still creates the request; telegram blocked, email pending
  UPDATE platform_notification_settings
  SET telegram_chat_id = NULL, updated_at = now()
  WHERE id = 1;

  INSERT INTO platform_purchase_quotes (
    organization_id, requester_user_id, sku, method_code, amount, currency,
    pricing_revision, payment_details_snapshot, expires_at
  )
  VALUES (
    v_org, v_owner, 'crm_subscription', 'bankTransfer', '29', 'USD',
    1, 'IBAN test', v_now + interval '1 day'
  )
  RETURNING id INTO v_quote_id;

  v_result := submit_platform_purchase_request(
    v_quote_id, 'd7111111-1111-4111-8111-111111111111'::uuid, v_org, v_owner,
    's5a-owner@test.local', 'S5a Demo', 's5a-owner@test.local', '@s5a',
    'paid vietcombank comment long enough'
  );
  v_req_id := (v_result ->> 'request_id')::uuid;
  PERFORM _test_assert(v_req_id IS NOT NULL, 'submit created purchase request');

  SELECT * INTO v_email
  FROM platform_notification_outbox
  WHERE source_id = v_req_id AND channel = 'email';
  SELECT * INTO v_tg
  FROM platform_notification_outbox
  WHERE source_id = v_req_id AND channel = 'telegram';

  PERFORM _test_assert(v_email.id IS NOT NULL, 'email outbox row exists');
  PERFORM _test_assert(v_email.status = 'pending', 'email pending without telegram config');
  PERFORM _test_assert(v_email.attempts = 0, 'email attempts unused');
  PERFORM _test_assert(v_tg.status = 'blocked', 'telegram blocked without chat_id');
  PERFORM _test_assert(v_tg.last_error_code = 'config_missing', 'telegram config_missing');
  PERFORM _test_assert(v_tg.attempts = 0, 'blocked does not burn attempts');
  PERFORM _test_assert(
    v_tg.payload ? 'telegram_text' AND char_length(v_tg.payload ->> 'telegram_text') <= 4096,
    'telegram text sanitized and clipped'
  );
  PERFORM _test_assert(NOT (v_tg.payload ? 'bot_token'), 'payload has no bot token');
  PERFORM _test_assert(
    EXISTS (SELECT 1 FROM platform_purchase_requests WHERE id = v_req_id),
    'request survives telegram config_missing'
  );

  -- dedupe: second enqueue same key returns the same row
  v_id := enqueue_platform_notification(
    'email', 'purchase_request', 'platform_purchase_request', v_req_id,
    'purchase:' || v_req_id::text || ':email',
    '{"telegram_text":"dup"}'::jsonb
  );
  PERFORM _test_assert(v_id = v_email.id, 'dedupe returns existing email row');

  -- requeue blocked telegram
  PERFORM _test_assert(requeue_blocked_platform_notification(v_tg.id), 'requeue blocked telegram');
  SELECT status, attempts INTO v_status, v_attempts
  FROM platform_notification_outbox WHERE id = v_tg.id;
  PERFORM _test_assert(v_status = 'pending', 'requeued status pending');
  PERFORM _test_assert(v_attempts = 0, 'requeue does not change attempts');

  -- keep email out of this claim so we fence the telegram row
  UPDATE platform_notification_outbox
  SET available_at = now() + interval '1 hour'
  WHERE id = v_email.id;

  -- lease: claim fencing
  SELECT * INTO v_claimed
  FROM claim_platform_notification_outbox(10, 'worker-a', 120)
  WHERE id = v_tg.id;
  PERFORM _test_assert(v_claimed.status = 'processing', 'claim sets processing');
  PERFORM _test_assert(v_claimed.claim_token IS NOT NULL, 'claim issues token');
  v_token := v_claimed.claim_token;

  SELECT count(*) INTO v_n
  FROM claim_platform_notification_outbox(10, 'worker-b', 120)
  WHERE id = v_tg.id;
  PERFORM _test_assert(v_n = 0, 'leased row not claimed by second worker');

  PERFORM complete_platform_notification_outbox(v_tg.id, 'sent', NULL, NULL, gen_random_uuid());
  SELECT status INTO v_status FROM platform_notification_outbox WHERE id = v_tg.id;
  PERFORM _test_assert(v_status = 'processing', 'wrong claim_token is a no-op');

  PERFORM complete_platform_notification_outbox(v_tg.id, 'retry', 'send_failed', 15, v_token);
  SELECT status, attempts INTO v_status, v_attempts
  FROM platform_notification_outbox WHERE id = v_tg.id;
  PERFORM _test_assert(v_status = 'retry', 'valid token retries');
  PERFORM _test_assert(v_attempts = 1, 'retry burns one attempt');

  -- expire lease → reclaim
  UPDATE platform_notification_outbox
  SET status = 'processing',
      lease_until = now() - interval '1 second',
      lease_owner = 'stale',
      claim_token = gen_random_uuid()
  WHERE id = v_email.id;

  SELECT * INTO v_claimed2
  FROM claim_platform_notification_outbox(10, 'worker-c', 120)
  WHERE id = v_email.id;
  PERFORM _test_assert(v_claimed2.id IS NOT NULL, 'expired lease is reclaimable');

  -- dead after max attempts
  UPDATE platform_notification_outbox
  SET attempts = max_attempts - 1,
      status = 'processing',
      claim_token = 'e7111111-1111-4111-8111-111111111111'::uuid,
      lease_until = now() + interval '2 minutes'
  WHERE id = v_email.id;

  PERFORM complete_platform_notification_outbox(
    v_email.id, 'retry', 'send_failed', 15, 'e7111111-1111-4111-8111-111111111111'::uuid
  );
  SELECT status INTO v_status FROM platform_notification_outbox WHERE id = v_email.id;
  PERFORM _test_assert(v_status = 'dead', 'exhausted retry becomes dead');

  -- channel failure (telegram dead) does not delete the purchase request
  INSERT INTO platform_purchase_quotes (
    organization_id, requester_user_id, sku, method_code, amount, currency,
    pricing_revision, payment_details_snapshot, expires_at
  )
  VALUES (
    v_org, v_owner, 'crm_license', 'bankTransfer', '199', 'USD',
    1, 'IBAN test 2', v_now + interval '1 day'
  )
  RETURNING id INTO v_quote_id2;

  v_result := submit_platform_purchase_request(
    v_quote_id2, 'd7222222-2222-4222-8222-222222222222'::uuid, v_org, v_owner,
    's5a-owner@test.local', 'S5a Demo', NULL, NULL, 'second request comment long enough'
  );
  v_req_alive := (v_result ->> 'request_id')::uuid;

  SELECT id INTO v_id2
  FROM platform_notification_outbox
  WHERE source_id = v_req_alive AND channel = 'telegram';

  UPDATE platform_notification_outbox
  SET status = 'processing',
      claim_token = 'e7222222-2222-4222-8222-222222222222'::uuid,
      lease_until = now() + interval '2 minutes'
  WHERE id = v_id2;

  PERFORM complete_platform_notification_outbox(
    v_id2, 'blocked', 'forbidden', NULL, 'e7222222-2222-4222-8222-222222222222'::uuid
  );
  PERFORM _test_assert(
    EXISTS (SELECT 1 FROM platform_purchase_requests WHERE id = v_req_alive AND status = 'new'),
    'blocked telegram does not roll back purchase request'
  );
  SELECT attempts INTO v_attempts FROM platform_notification_outbox WHERE id = v_id2;
  PERFORM _test_assert(v_attempts = 0, 'blocked 403 does not burn attempts');

  RAISE NOTICE 'All S5a platform notification outbox tests passed';
END;
$$;

ROLLBACK;
