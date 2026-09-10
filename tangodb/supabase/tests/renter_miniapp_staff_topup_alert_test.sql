-- HALL-RENT-TOPUP-2: staff receipt-chat alert, username persist, group bind.
-- Run: npm run test:db:renter-miniapp-staff-topup-alert

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

CREATE OR REPLACE FUNCTION _ht2_set_renter_jwt(p_user uuid, p_org uuid, p_telegram bigint, p_renter uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', p_user::text,
      'role', 'authenticated',
      'app_metadata', json_build_object(
        'actor', 'renter',
        'organization_id', p_org::text,
        'telegram_id', p_telegram::text,
        'renter_id', p_renter::text
      )
    )::text,
    true
  );
END;
$$;

DO $$
DECLARE
  v_version_id uuid;
  v_org uuid := 'a2110000-0000-4000-8000-000000000001';
  v_user uuid := 'a2110000-0000-4000-8000-000000000011';
  v_acc_user uuid := 'a2110000-0000-4000-8000-000000000012';
  v_renter_user uuid := 'a2110000-0000-4000-8000-000000000013';
  v_member uuid := 'a2110000-0000-4000-8000-000000000021';
  v_acc_member uuid := 'a2110000-0000-4000-8000-000000000022';
  v_renter uuid := 'a2110000-0000-4000-8000-000000000041';
  v_session uuid := 'a2110000-0000-4000-8000-000000000051';
  v_result jsonb;
  v_prep jsonb;
  v_id uuid;
  v_n int;
  v_tg bigint;
  v_uname text;
  v_status text;
  v_name text;
  v_raised boolean;
  v_chat bigint;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);

  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES
    (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'ht2-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_acc_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'ht2-acc@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_renter_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'ht2-renter@users.invalid', crypt('testpass123', gen_salt('bf')), now(), now(), now(),
     jsonb_build_object('actor', 'renter', 'organization_id', v_org::text, 'telegram_id', '21101', 'renter_id', v_renter::text),
     '{}'::jsonb)
  ON CONFLICT (id) DO UPDATE SET raw_app_meta_data = EXCLUDED.raw_app_meta_data;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'HT2 Staff Alert Org', 'ht2-staff-alert', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed', owner_user_id = EXCLUDED.owner_user_id;

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET license_type = 'lifetime', activated_at = now();

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name, is_active)
  VALUES
    (v_member, v_org, v_user, 'owner', 'HT2 Owner', true),
    (v_acc_member, v_org, v_acc_user, 'accountant', 'HT2 Acc', true)
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, currency_code, locale, branding_name)
  VALUES (v_org, 'Europe/Moscow', 'RUB', 'ru', 'HT2 Studio')
  ON CONFLICT (organization_id) DO UPDATE SET
    timezone = EXCLUDED.timezone,
    currency_code = EXCLUDED.currency_code,
    locale = EXCLUDED.locale,
    finance_period_closed_until = NULL;

  INSERT INTO organization_renter_channel (organization_id, telegram_chat_url, bot_username, telegram_bot_id)
  VALUES (v_org, 'https://t.me/+ht2invite', 'ht2_bot', 211001)
  ON CONFLICT (organization_id) DO UPDATE SET
    telegram_chat_url = EXCLUDED.telegram_chat_url,
    bot_username = EXCLUDED.bot_username,
    telegram_bot_id = EXCLUDED.telegram_bot_id,
    telegram_receipt_chat_id = NULL,
    telegram_receipt_chat_bound_at = NULL;

  INSERT INTO renters (
    id, organization_id, display_name, telegram_id, telegram_username, status, auth_user_id
  )
  VALUES (v_renter, v_org, 'HT2 Renter', 21101, NULL, 'active', v_renter_user)
  ON CONFLICT (id) DO UPDATE SET
    telegram_id = EXCLUDED.telegram_id,
    telegram_username = NULL,
    display_name = EXCLUDED.display_name,
    status = 'active',
    auth_user_id = v_renter_user;

  -- username persist, display_name untouched
  v_result := renter_telegram_mint_prepare(jsonb_build_object(
    'organization_id', v_org,
    'telegram_id', '21101',
    'display_name', 'Should Not Overwrite',
    'telegram_username', '@HallRenter',
    'init_data_hash', 'ht2_hash_user_1',
    'allows_write_to_pm', false
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'mint with username');
  SELECT r.telegram_username, r.display_name INTO v_uname, v_name
  FROM renters r WHERE r.id = v_renter;
  PERFORM _test_assert(v_uname = 'HallRenter', 'username stored without @');
  PERFORM _test_assert(v_name = 'HT2 Renter', 'display_name not overwritten');

  v_result := renter_telegram_mint_prepare(jsonb_build_object(
    'organization_id', v_org,
    'telegram_id', '21101',
    'display_name', 'Ignored',
    'telegram_username', NULL,
    'init_data_hash', 'ht2_hash_user_2',
    'allows_write_to_pm', false
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'mint clears username');
  SELECT r.telegram_username INTO v_uname FROM renters r WHERE r.id = v_renter;
  PERFORM _test_assert(v_uname IS NULL, 'username cleared when initData has none');

  UPDATE renters SET telegram_username = 'HallRenter' WHERE id = v_renter;

  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');
  v_result := get_organization_renter_channel();
  PERFORM _test_assert(
    v_result ->> 'telegram_receipt_notify_status' = 'need_bot_in_group',
    'invite without bind → need_bot_in_group'
  );

  -- random group (no username, invite already? wait invite allows first bind)
  -- mismatch public username must not bind
  UPDATE organization_renter_channel
  SET telegram_chat_url = 'https://t.me/ht2studio', telegram_receipt_chat_id = NULL
  WHERE organization_id = v_org;

  v_result := renter_telegram_receipt_chat_ingest(jsonb_build_object(
    'organization_id', v_org,
    'chat_id', '-100211111',
    'chat_username', 'otherhall',
    'action', 'bind'
  ));
  PERFORM _test_assert((v_result ->> 'bound')::boolean IS DISTINCT FROM true, 'random group not bound');

  v_result := renter_telegram_receipt_chat_ingest(jsonb_build_object(
    'organization_id', v_org,
    'chat_id', '-100211222',
    'chat_username', 'ht2studio',
    'action', 'bind'
  ));
  PERFORM _test_assert((v_result ->> 'bound')::boolean, 'username match binds group');
  SELECT telegram_receipt_chat_id INTO v_chat
  FROM organization_renter_channel WHERE organization_id = v_org;
  PERFORM _test_assert(v_chat = -100211222, 'stored group chat_id');

  v_result := renter_telegram_receipt_chat_ingest(jsonb_build_object(
    'organization_id', v_org,
    'chat_id', '-100211222',
    'action', 'unbind'
  ));
  PERFORM _test_assert((v_result ->> 'cleared')::boolean, 'kick clears matching chat_id');

  UPDATE organization_renter_channel
  SET telegram_chat_url = 'https://t.me/+ht2invite2',
      telegram_receipt_chat_id = NULL,
      telegram_receipt_candidate_chat_id = NULL
  WHERE organization_id = v_org;

  v_result := renter_telegram_receipt_chat_ingest(jsonb_build_object(
    'organization_id', v_org,
    'chat_id', '-100211333',
    'chat_title', 'Studio receipts',
    'action', 'bind'
  ));
  PERFORM _test_assert((v_result ->> 'bound')::boolean IS DISTINCT FROM true, 'invite does not auto-bind');
  PERFORM _test_assert((v_result ->> 'candidate')::boolean, 'invite stores candidate');

  v_result := renter_telegram_receipt_chat_ingest(jsonb_build_object(
    'organization_id', v_org,
    'chat_id', '-100211334',
    'chat_title', 'Wrong group',
    'action', 'bind'
  ));
  PERFORM _test_assert((v_result ->> 'bound')::boolean IS DISTINCT FROM true, 'second invite group still not bound');
  SELECT telegram_receipt_candidate_chat_id INTO v_chat
  FROM organization_renter_channel WHERE organization_id = v_org;
  PERFORM _test_assert(v_chat = -100211334, 'latest invite group replaces candidate');

  v_result := confirm_organization_renter_receipt_chat();
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'staff confirms candidate');
  PERFORM _test_assert((v_result ->> 'telegram_receipt_chat_id')::bigint = -100211334, 'confirm binds candidate');
  PERFORM _test_assert(v_result ->> 'telegram_receipt_notify_status' = 'bound', 'status bound after confirm');

  v_result := renter_telegram_receipt_chat_ingest(jsonb_build_object(
    'organization_id', v_org,
    'chat_id', '-100211335',
    'action', 'bind'
  ));
  PERFORM _test_assert((v_result ->> 'bound')::boolean IS DISTINCT FROM true, 'invite ignored once already bound');
  SELECT telegram_receipt_chat_id INTO v_chat
  FROM organization_renter_channel WHERE organization_id = v_org;
  PERFORM _test_assert(v_chat = -100211334, 'bound chat_id unchanged by extra group');

  -- private Start matching tg://user?id=
  UPDATE organization_renter_channel
  SET telegram_chat_url = 'tg://user?id=55501', telegram_receipt_chat_id = NULL
  WHERE organization_id = v_org;

  v_result := renter_telegram_receipt_chat_ingest(jsonb_build_object(
    'organization_id', v_org,
    'chat_id', '55501',
    'from_username', 'owner',
    'action', 'bind'
  ));
  PERFORM _test_assert((v_result ->> 'bound')::boolean, 'private user id binds');

  v_result := get_organization_renter_channel();
  PERFORM _test_assert(v_result ->> 'telegram_receipt_notify_status' = 'bound', 'status bound');

  v_result := update_organization_renter_channel(jsonb_build_object(
    'telegram_chat_url', 'https://t.me/+ht2other',
    'app_short_name', 'hall'
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'url change saved');
  PERFORM _test_assert(v_result ->> 'telegram_receipt_chat_id' IS NULL, 'url change clears bind');
  PERFORM _test_assert(
    v_result ->> 'telegram_receipt_notify_status' = 'need_bot_in_group',
    'cleared invite → need_bot_in_group'
  );

  UPDATE organization_renter_channel
  SET telegram_chat_url = 'tg://user?id=55501', telegram_receipt_chat_id = NULL
  WHERE organization_id = v_org;
  v_result := get_organization_renter_channel();
  PERFORM _test_assert(v_result ->> 'telegram_receipt_notify_status' = 'need_start', 'dm url need_start');

  -- Split: receipts stay private; CRM alerts bind a public group independently.
  UPDATE organization_renter_channel
  SET telegram_chat_url = 'tg://user?id=55501',
      telegram_staff_alert_chat_url = 'https://t.me/ht2studio',
      telegram_receipt_chat_id = NULL,
      telegram_receipt_candidate_chat_id = NULL
  WHERE organization_id = v_org;

  v_result := renter_telegram_receipt_chat_ingest(jsonb_build_object(
    'organization_id', v_org,
    'chat_id', '55501',
    'from_username', 'owner',
    'action', 'bind'
  ));
  PERFORM _test_assert((v_result ->> 'bound')::boolean IS DISTINCT FROM true, 'receipts DM does not bind staff group');

  v_result := renter_telegram_receipt_chat_ingest(jsonb_build_object(
    'organization_id', v_org,
    'chat_id', '-100211666',
    'chat_username', 'ht2studio',
    'action', 'bind'
  ));
  PERFORM _test_assert((v_result ->> 'bound')::boolean, 'staff group username binds while receipts stay DM');
  SELECT telegram_receipt_chat_id INTO v_chat
  FROM organization_renter_channel WHERE organization_id = v_org;
  PERFORM _test_assert(v_chat = -100211666, 'staff bind stored');

  v_result := update_organization_renter_channel(jsonb_build_object(
    'telegram_chat_url', 'https://t.me/adminperson',
    'telegram_staff_alert_chat_url', 'https://t.me/ht2studio',
    'app_short_name', 'hall'
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'receipts URL change saved');
  PERFORM _test_assert(
    (v_result ->> 'telegram_receipt_chat_id')::bigint = -100211666,
    'changing receipts URL does not clear staff bind'
  );
  PERFORM _test_assert(v_result ->> 'telegram_chat_url' = 'https://t.me/adminperson', 'receipts URL updated');
  PERFORM _test_assert(
    v_result ->> 'telegram_staff_alert_chat_url' = 'https://t.me/ht2studio',
    'staff URL unchanged'
  );

  v_result := update_organization_renter_channel(jsonb_build_object(
    'telegram_chat_url', 'https://t.me/adminperson',
    'telegram_staff_alert_chat_url', 'https://t.me/+ht2otherstaff',
    'app_short_name', 'hall'
  ));
  PERFORM _test_assert(v_result ->> 'telegram_receipt_chat_id' IS NULL, 'staff URL change clears bind');
  PERFORM _test_assert(
    v_result ->> 'telegram_receipt_notify_status' = 'need_bot_in_group',
    'cleared staff invite → need_bot_in_group'
  );

  -- CHECK: renter events cannot use negative chat_id
  v_raised := false;
  BEGIN
    INSERT INTO renter_telegram_outbox (
      organization_id, renter_id, telegram_id, event_type, text, dedupe_key
    ) VALUES (
      v_org, v_renter, -100211444, 'topup_created', 'nope', 'ht2_neg_renter'
    );
  EXCEPTION WHEN check_violation THEN
    v_raised := true;
  END;
  PERFORM _test_assert(v_raised, 'renter outbox rejects negative chat_id');

  -- submit without bind (invite URL) — request ok, no staff row
  UPDATE organization_renter_channel
  SET telegram_chat_url = 'https://t.me/+ht2nobind',
      telegram_staff_alert_chat_url = NULL,
      telegram_receipt_chat_id = NULL
  WHERE organization_id = v_org;

  DELETE FROM renter_telegram_outbox WHERE organization_id = v_org;
  DELETE FROM renter_topup_requests WHERE renter_id = v_renter;

  PERFORM _ht2_set_renter_jwt(v_renter_user, v_org, 21101, v_renter);
  v_result := renter_submit_topup(jsonb_build_object('amount', 200, 'method', 'cash'));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'submit ok without receipt chat_id');
  SELECT count(*) INTO v_n
  FROM renter_telegram_outbox
  WHERE organization_id = v_org AND event_type = 'staff_topup_submitted';
  PERFORM _test_assert(v_n = 0, 'no staff enqueue without chat_id');
  SELECT count(*) INTO v_n
  FROM renter_telegram_outbox
  WHERE organization_id = v_org AND event_type = 'topup_created';
  PERFORM _test_assert(v_n = 1, 'renter topup_created still enqueued');

  DELETE FROM renter_telegram_outbox WHERE organization_id = v_org;
  DELETE FROM renter_topup_requests WHERE renter_id = v_renter;

  -- submit with bound group chat_id
  UPDATE organization_renter_channel
  SET telegram_receipt_chat_id = -100211555, telegram_receipt_chat_bound_at = now()
  WHERE organization_id = v_org;

  v_result := renter_submit_topup(jsonb_build_object('amount', 300, 'method', 'cash'));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'submit with group chat_id');
  PERFORM _test_assert(v_result ->> 'correlation_code' IS NOT NULL, 'correlation code present');

  SELECT o.id, o.telegram_id INTO v_id, v_tg
  FROM renter_telegram_outbox o
  WHERE o.organization_id = v_org AND o.event_type = 'staff_topup_submitted';
  PERFORM _test_assert(v_id IS NOT NULL, 'staff outbox row');
  PERFORM _test_assert(v_tg = -100211555, 'staff chat_id is group');
  PERFORM _test_assert(
    EXISTS (
      SELECT 1 FROM renter_telegram_outbox o
      WHERE o.organization_id = v_org AND o.event_type = 'topup_created' AND o.telegram_id = 21101
    ),
    'renter notification kept'
  );

  v_prep := renter_telegram_outbox_prepare_send(v_id);
  PERFORM _test_assert(v_prep ->> 'action' = 'send', 'staff group prepare send (no dialog gate)');
  PERFORM _test_assert((v_prep ->> 'telegram_id')::bigint = -100211555, 'prepare does not rebind to renter');
  PERFORM _test_assert((v_prep ->> 'include_miniapp_button')::boolean IS DISTINCT FROM true, 'no miniapp button for staff');
  PERFORM _test_assert(v_prep ->> 'text' LIKE '%HallRenter%', 'alert includes username');
  PERFORM _test_assert(v_prep ->> 'text' LIKE '%TDB-%', 'alert includes correlation code');
  PERFORM _test_assert(v_prep ->> 'text' LIKE '%tangodb.vercel.app/finance/renter-topup%', 'alert includes CRM inbox');

  DELETE FROM renter_telegram_outbox WHERE organization_id = v_org;
  DELETE FROM renter_topup_requests WHERE renter_id = v_renter;

  -- resolve from URL tg://user?id= without stored bind
  UPDATE organization_renter_channel
  SET telegram_chat_url = 'tg://user?id=55501',
      telegram_staff_alert_chat_url = NULL,
      telegram_receipt_chat_id = NULL
  WHERE organization_id = v_org;

  v_result := renter_submit_topup(jsonb_build_object('amount', 150, 'method', 'cash'));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'submit resolves tg://user id');
  SELECT o.telegram_id INTO v_tg
  FROM renter_telegram_outbox o
  WHERE o.organization_id = v_org AND o.event_type = 'staff_topup_submitted';
  PERFORM _test_assert(v_tg = 55501, 'staff target from URL user id');

  v_prep := renter_telegram_outbox_prepare_send(
    (SELECT o.id FROM renter_telegram_outbox o
     WHERE o.organization_id = v_org AND o.event_type = 'staff_topup_submitted')
  );
  PERFORM _test_assert(v_prep ->> 'action' = 'gate_wait', 'private staff waits for Start');

  UPDATE renter_telegram_outbox
  SET status = 'skipped', last_error_code = 'no_bot_started', gate_wait_count = 20
  WHERE organization_id = v_org AND event_type = 'staff_topup_submitted';

  v_result := renter_telegram_webhook_ingest(jsonb_build_object(
    'organization_id', v_org,
    'telegram_id', '55501',
    'telegram_bot_id', '211001',
    'update_id', '2119001',
    'is_start', true,
    'blocked', false,
    'allows_write', true
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'Start ingest');
  SELECT o.status INTO v_status
  FROM renter_telegram_outbox o
  WHERE o.organization_id = v_org AND o.event_type = 'staff_topup_submitted';
  PERFORM _test_assert(v_status = 'pending', 'Start releases skipped staff alert');

  PERFORM _hall_rent_test_set_jwt(v_acc_user, v_org, v_acc_member, 'accountant');
  v_result := get_renter_detail(v_renter);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'accountant can read renter');
  PERFORM _test_assert(
    (v_result -> 'renter' ->> 'telegram_username') = 'HallRenter',
    'accountant sees telegram username'
  );
  PERFORM _test_assert(
    (v_result -> 'renter' ->> 'telegram_id') = '21101',
    'accountant sees telegram id'
  );

  RAISE NOTICE 'renter_miniapp_staff_topup_alert_test: OK';
END;
$$;

ROLLBACK;
