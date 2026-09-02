-- R2: channel allowlist, QR, topup inbox/staff, dialog persist, get_renter_detail wallet.
-- Run: psql "%DATABASE_URL%" -v ON_ERROR_STOP=1 -f supabase/tests/_hall_rent_test_jwt.sql -f supabase/tests/renter_miniapp_r2_channel_topup_test.sql

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

CREATE OR REPLACE FUNCTION _r2_set_renter_jwt(p_user uuid, p_org uuid, p_telegram bigint)
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
        'telegram_id', p_telegram::text
      )
    )::text,
    true
  );
END;
$$;

DO $$
DECLARE
  v_version_id uuid;
  v_org uuid := 'a1e00000-0000-4000-8000-000000000001';
  v_org2 uuid := 'a1e00000-0000-4000-8000-000000000002';
  v_user uuid := 'a1e00000-0000-4000-8000-000000000011';
  v_acc_user uuid := 'a1e00000-0000-4000-8000-000000000012';
  v_renter_user uuid := 'a1e00000-0000-4000-8000-000000000013';
  v_teacher_user uuid := 'a1e00000-0000-4000-8000-000000000014';
  v_member uuid := 'a1e00000-0000-4000-8000-000000000021';
  v_acc_member uuid := 'a1e00000-0000-4000-8000-000000000022';
  v_teacher_member uuid := 'a1e00000-0000-4000-8000-000000000024';
  v_member2 uuid := 'a1e00000-0000-4000-8000-000000000025';
  v_loc uuid := 'a1e00000-0000-4000-8000-0000000000aa';
  v_renter uuid := 'a1e00000-0000-4000-8000-000000000041';
  v_renter2 uuid := 'a1e00000-0000-4000-8000-000000000042';
  v_renter_arch uuid := 'a1e00000-0000-4000-8000-000000000043';
  v_renter_ban uuid := 'a1e00000-0000-4000-8000-000000000044';
  v_session uuid := 'a1e00000-0000-4000-8000-000000000051';
  v_qr uuid;
  v_req uuid;
  v_req2 uuid;
  v_key uuid;
  v_result jsonb;
  v_href text;
  v_n int;
  v_today date;
  v_op date;
  v_raised boolean;
  v_started timestamptz;
  v_spendable numeric;
  v_reserved numeric;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES
    (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'r2-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_acc_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'r2-acc@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_teacher_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'r2-teacher@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_renter_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'r2-renter@users.invalid', crypt('testpass123', gen_salt('bf')), now(), now(), now(),
     jsonb_build_object('actor', 'renter', 'organization_id', v_org::text, 'telegram_id', '93001'),
     '{}'::jsonb)
  ON CONFLICT (id) DO UPDATE SET raw_app_meta_data = EXCLUDED.raw_app_meta_data;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES
    (v_org, 'R2 Channel Org', 'r2-channel', 'licensed', v_version_id, v_user),
    (v_org2, 'R2 Other Org', 'r2-other', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed', owner_user_id = EXCLUDED.owner_user_id;

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES
    (v_org, v_version_id, 'lifetime', now()),
    (v_org2, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET license_type = 'lifetime', activated_at = now();

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES
    (v_member, v_org, v_user, 'owner', 'R2 Owner'),
    (v_acc_member, v_org, v_acc_user, 'accountant', 'R2 Acc'),
    (v_teacher_member, v_org, v_teacher_user, 'teacher', 'R2 Teacher'),
    (v_member2, v_org2, v_user, 'owner', 'R2 Owner Org2')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, currency_code, locale, branding_name)
  VALUES
    (v_org, 'Europe/Moscow', 'RUB', 'ru', 'R2 Studio'),
    (v_org2, 'Europe/Moscow', 'RUB', 'ru', 'R2 Other')
  ON CONFLICT (organization_id) DO UPDATE SET
    timezone = EXCLUDED.timezone,
    currency_code = EXCLUDED.currency_code,
    locale = EXCLUDED.locale,
    finance_period_closed_until = NULL;

  INSERT INTO locations (id, organization_id, name, miniapp_enabled)
  VALUES (v_loc, v_org, 'Hall R2', true)
  ON CONFLICT (id) DO UPDATE SET miniapp_enabled = true;

  INSERT INTO renters (id, organization_id, display_name, telegram_id, status, archived_at, booking_banned_at, auth_user_id)
  VALUES
    (v_renter, v_org, 'R2 Renter', 93001, 'active', NULL, NULL, v_renter_user),
    (v_renter2, v_org, 'R2 Renter Two', 93002, 'active', NULL, NULL, NULL),
    (v_renter_arch, v_org, 'R2 Archived', 93003, 'archived', now(), NULL, NULL),
    (v_renter_ban, v_org, 'R2 Banned', 93004, 'active', NULL, now(), NULL)
  ON CONFLICT (id) DO UPDATE SET
    telegram_id = EXCLUDED.telegram_id,
    status = EXCLUDED.status,
    archived_at = EXCLUDED.archived_at,
    booking_banned_at = EXCLUDED.booking_banned_at,
    auth_user_id = EXCLUDED.auth_user_id;

  INSERT INTO organization_addons (organization_id, addon_code, status, period_start, period_end)
  VALUES (v_org, 'renter_miniapp', 'active', CURRENT_DATE - 1, CURRENT_DATE + 365)
  ON CONFLICT (organization_id, addon_code) DO UPDATE SET
    status = 'active', period_start = EXCLUDED.period_start, period_end = EXCLUDED.period_end;

  PERFORM _test_assert(
    NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'organization_renter_channel'
        AND column_name = 'mini_app_url'
    ),
    'no mini_app_url column'
  );
  PERFORM _test_assert(
    EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgname = 'renters_revoke_auth_on_identity_change_trg'
    ),
    'revoke trigger present'
  );

  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');

  -- t.me/share refused
  v_result := update_organization_renter_channel(jsonb_build_object(
    'telegram_chat_url', 'https://t.me/share',
    'app_short_name', 'app'
  ));
  PERFORM _test_assert(
    v_result ->> 'error' = 'renter.channel.chatUrlInvalid',
    't.me/share refused'
  );

  v_result := update_organization_renter_channel(jsonb_build_object(
    'telegram_chat_url', 'https://t.me/r2studio',
    'app_short_name', 'hall'
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'allowlisted chat saved');

  PERFORM _r2_set_renter_jwt(v_renter_user, v_org, 93001);
  v_result := renter_bootstrap();
  PERFORM _test_assert(
    (v_result ->> 'success')::boolean
    AND v_result ->> 'chat_url' = 'https://t.me/r2studio'
    AND v_result ->> 'timezone' = 'Europe/Moscow'
    AND v_result ->> 'currency_code' = 'RUB'
    AND v_result ->> 'locale' = 'ru'
    AND (v_result ->> 'bot_started') = 'false',
    'bootstrap keep R1c fields + allowlisted chat'
  );

  PERFORM _hall_rent_test_set_jwt(v_teacher_user, v_org, v_teacher_member, 'teacher');
  v_result := get_organization_renter_channel();
  PERFORM _test_assert(
    (v_result ->> 'success') IS DISTINCT FROM 'true',
    'teacher cannot read channel'
  );

  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');

  -- SVG mime refused
  v_raised := false;
  BEGIN
    INSERT INTO organization_rental_qr_assets (
      organization_id, storage_path, mime_type, file_size, is_active
    ) VALUES (v_org, v_org::text || '/svg', 'image/svg+xml', 100, true);
  EXCEPTION WHEN check_violation THEN
    v_raised := true;
  END;
  PERFORM _test_assert(v_raised, 'SVG mime INSERT refused');

  v_result := create_organization_rental_qr_asset(jsonb_build_object(
    'organization_id', v_org,
    'storage_path', v_org::text || '/qr1',
    'mime_type', 'image/png',
    'file_size', '120',
    'width', '64',
    'height', '64',
    'label', 'Studio QR',
    'is_active', true
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'png QR created');
  v_qr := (v_result ->> 'id')::uuid;

  -- webhook Start without renters row
  v_result := renter_telegram_webhook_ingest(jsonb_build_object(
    'organization_id', v_org,
    'telegram_id', '93999',
    'telegram_bot_id', '88001',
    'update_id', '1',
    'is_start', true,
    'allows_write', true
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'webhook start ingest');
  PERFORM _test_assert(
    EXISTS (
      SELECT 1 FROM renter_telegram_dialog d
      WHERE d.organization_id = v_org AND d.telegram_id = 93999 AND d.bot_started_at IS NOT NULL
    )
    AND NOT EXISTS (SELECT 1 FROM renters r WHERE r.organization_id = v_org AND r.telegram_id = 93999),
    'Start persist without renters row'
  );

  v_result := renter_telegram_webhook_ingest(jsonb_build_object(
    'organization_id', v_org,
    'telegram_id', '93998',
    'telegram_bot_id', '88001',
    'update_id', '2',
    'is_start', false
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'webhook non-start ingest');
  SELECT d.bot_started_at INTO v_started
  FROM renter_telegram_dialog d
  WHERE d.organization_id = v_org AND d.telegram_id = 93998;
  PERFORM _test_assert(v_started IS NULL, 'webhook without /start does not set bot_started');

  -- UNIQUE telegram_bot_id
  INSERT INTO organization_renter_channel (organization_id, telegram_bot_id, bot_username, app_short_name)
  VALUES (v_org, 1001, 'r2bot', 'hall')
  ON CONFLICT (organization_id) DO UPDATE SET
    telegram_bot_id = 1001,
    bot_username = 'r2bot',
    app_short_name = COALESCE(organization_renter_channel.app_short_name, 'hall');

  v_raised := false;
  BEGIN
    INSERT INTO organization_renter_channel (organization_id, telegram_bot_id)
    VALUES (v_org2, 1001);
  EXCEPTION WHEN unique_violation THEN
    v_raised := true;
  END;
  PERFORM _test_assert(v_raised, 'UNIQUE telegram_bot_id');

  v_href := _renter_miniapp_direct_link(v_org);
  PERFORM _test_assert(
    v_href = 'https://t.me/r2bot/hall?startapp=' || v_org::text,
    'Mini App href from getMe username + short name'
  );

  -- staff telegram unique + revoke
  v_result := upsert_renter(jsonb_build_object(
    'renter_id', v_renter2,
    'display_name', 'R2 Renter Two',
    'telegram_id', '93001'
  ));
  PERFORM _test_assert(
    v_result ->> 'error' = 'renters.error.telegramIdTaken',
    'staff telegram_id taken'
  );

  INSERT INTO auth.sessions (id, user_id, created_at, updated_at)
  VALUES (v_session, v_renter_user, now(), now())
  ON CONFLICT (id) DO NOTHING;
  UPDATE renters SET telegram_id = NULL WHERE id = v_renter;
  PERFORM _test_assert(
    NOT EXISTS (SELECT 1 FROM auth.sessions WHERE id = v_session),
    'clearing telegram_id revokes sessions'
  );
  UPDATE renters SET telegram_id = 93001 WHERE id = v_renter;

  PERFORM _r2_set_renter_jwt(v_renter_user, v_org, 93001);
  v_result := get_renter_detail(v_renter);
  PERFORM _test_assert(
    (v_result ->> 'success') IS DISTINCT FROM 'true',
    'renter JWT cannot call get_renter_detail'
  );

  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');
  v_key := gen_random_uuid();
  v_result := staff_renter_wallet_topup(jsonb_build_object(
    'renter_id', v_renter,
    'amount', 150,
    'method', 'cash',
    'idempotency_key', v_key
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'staff-topup ok');
  v_result := staff_renter_wallet_topup(jsonb_build_object(
    'renter_id', v_renter,
    'amount', 150,
    'method', 'cash',
    'idempotency_key', v_key
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'staff-topup idempotent');
  SELECT count(*) INTO v_n FROM renter_wallet_ledger
  WHERE renter_id = v_renter AND entry_type = 'topup' AND topup_request_id IS NULL;
  PERFORM _test_assert(v_n = 1, 'staff-topup one ledger under same key');

  v_result := get_renter_detail(v_renter);
  v_spendable := (v_result -> 'finance' ->> 'spendable')::numeric;
  v_reserved := (v_result -> 'finance' ->> 'reserved_prepay')::numeric;
  PERFORM _test_assert(
    (v_result ->> 'success')::boolean
    AND v_spendable IS NOT NULL
    AND v_reserved IS NOT NULL
    AND v_spendable >= 150,
    'get_renter_detail spendable/reserved'
  );

  PERFORM _r2_set_renter_jwt(v_renter_user, v_org, 93001);
  v_result := renter_submit_topup(jsonb_build_object('amount', 1000001, 'method', 'cash'));
  PERFORM _test_assert(
    v_result ->> 'error' = 'renter.topup.amountTooLarge',
    'amount > 1000000 refused'
  );

  v_result := renter_submit_topup(jsonb_build_object('amount', 200, 'method', 'cash'));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'submit_topup cash');
  v_req := (v_result ->> 'id')::uuid;

  v_result := renter_submit_topup(jsonb_build_object('amount', 50, 'method', 'cash'));
  PERFORM _test_assert(
    v_result ->> 'error' = 'renter.topup.pendingExists',
    'second pending refused'
  );

  v_result := renter_submit_topup(jsonb_build_object(
    'amount', 80, 'method', 'qr', 'qr_asset_id', v_qr
  ));
  PERFORM _test_assert(
    (v_result ->> 'success') IS DISTINCT FROM 'true',
    'qr submit also blocked by pending'
  );

  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');

  -- confirm with amount_fact change
  v_key := gen_random_uuid();
  v_result := resolve_renter_topup(jsonb_build_object(
    'id', v_req,
    'action', 'confirm',
    'amount_fact', 180,
    'operation_date', '2000-01-01',
    'idempotency_key', v_key
  ));
  PERFORM _test_assert(
    (v_result ->> 'success')::boolean
    AND (v_result ->> 'amount_fact')::numeric = 180,
    'confirm amount_fact != request'
  );
  SELECT count(*) INTO v_n FROM renter_wallet_ledger
  WHERE renter_id = v_renter AND topup_request_id = v_req;
  PERFORM _test_assert(v_n = 1, 'one ledger for confirm');

  v_today := _org_local_date(v_org);
  SELECT a.operation_date INTO v_op
  FROM rental_advances a
  WHERE a.id = (v_result ->> 'advance_id')::uuid;
  PERFORM _test_assert(v_op = v_today, 'client operation_date ignored');

  v_result := resolve_renter_topup(jsonb_build_object(
    'id', v_req,
    'action', 'confirm',
    'amount_fact', 180,
    'idempotency_key', gen_random_uuid()
  ));
  PERFORM _test_assert(
    (v_result ->> 'already_applied')::boolean,
    'repeat confirm is no-op'
  );
  SELECT count(*) INTO v_n FROM renter_wallet_ledger
  WHERE renter_id = v_renter AND topup_request_id = v_req;
  PERFORM _test_assert(v_n = 1, 'repeat confirm no second ledger');

  v_result := resolve_renter_topup(jsonb_build_object(
    'id', v_req,
    'action', 'confirm',
    'amount_fact', 180,
    'idempotency_key', v_key
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'same idempotency key replay');
  SELECT count(*) INTO v_n FROM renter_wallet_ledger
  WHERE renter_id = v_renter AND topup_request_id = v_req;
  PERFORM _test_assert(v_n = 1, 'idempotency does not double ledger');

  -- pending QR refs block delete
  PERFORM _r2_set_renter_jwt(v_renter_user, v_org, 93001);
  v_result := renter_submit_topup(jsonb_build_object(
    'amount', 90, 'method', 'qr', 'qr_asset_id', v_qr
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'qr pending created');
  v_req2 := (v_result ->> 'id')::uuid;
  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');
  v_result := delete_organization_rental_qr_asset(v_qr);
  PERFORM _test_assert(v_result ->> 'error' = 'renter.qr.pendingRefs', 'pending refs block QR delete');

  -- closed period
  UPDATE organization_settings
  SET finance_period_closed_until = _org_local_date(v_org)
  WHERE organization_id = v_org;
  v_result := resolve_renter_topup(jsonb_build_object(
    'id', v_req2,
    'action', 'confirm',
    'idempotency_key', gen_random_uuid()
  ));
  PERFORM _test_assert(
    v_result ->> 'error' = 'finance.error.periodClosed',
    'resolve respects closed period'
  );
  UPDATE organization_settings SET finance_period_closed_until = NULL WHERE organization_id = v_org;

  -- two confirms under lock: sequential second is no-op
  v_result := resolve_renter_topup(jsonb_build_object(
    'id', v_req2, 'action', 'confirm', 'idempotency_key', gen_random_uuid()
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'first of two confirms');
  v_result := resolve_renter_topup(jsonb_build_object(
    'id', v_req2, 'action', 'confirm', 'idempotency_key', gen_random_uuid()
  ));
  PERFORM _test_assert((v_result ->> 'already_applied')::boolean, 'second confirm no-op');
  SELECT count(*) INTO v_n FROM renter_wallet_ledger
  WHERE renter_id = v_renter AND topup_request_id = v_req2;
  PERFORM _test_assert(v_n = 1, 'two confirms → one ledger');

  -- add-on off (demo CRM)
  UPDATE organizations SET status = 'demo_active' WHERE id = v_org;
  PERFORM _r2_set_renter_jwt(v_renter_user, v_org, 93001);
  v_result := renter_submit_topup(jsonb_build_object('amount', 40, 'method', 'cash'));
  PERFORM _test_assert(v_result ->> 'error' = 'renter.addonInactive', 'submit_topup off add-on');
  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');
  v_result := staff_renter_wallet_topup(jsonb_build_object(
    'renter_id', v_renter2, 'amount', 25, 'method', 'cash', 'idempotency_key', gen_random_uuid()
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'staff-topup allowed when add-on off');
  UPDATE organizations SET status = 'licensed' WHERE id = v_org;

  -- archived / ban can submit
  PERFORM _r2_set_renter_jwt(v_renter_user, v_org, 93003);
  v_result := renter_submit_topup(jsonb_build_object('amount', 33, 'method', 'cash'));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'archived submit_topup allowed');
  PERFORM _r2_set_renter_jwt(v_renter_user, v_org, 93004);
  v_result := renter_submit_topup(jsonb_build_object('amount', 34, 'method', 'cash'));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'banned submit_topup allowed');

  PERFORM _hall_rent_test_set_jwt(v_acc_user, v_org, v_acc_member, 'accountant');
  v_result := list_renter_topup_inbox('all', 50, 0);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'accountant sees topup inbox');
  v_result := get_organization_renter_channel();
  PERFORM _test_assert(
    (v_result ->> 'success') IS DISTINCT FROM 'true',
    'accountant cannot read bot channel'
  );

  PERFORM _hall_rent_test_set_jwt(v_teacher_user, v_org, v_teacher_member, 'teacher');
  v_result := list_renter_topup_inbox('pending', 50, 0);
  PERFORM _test_assert(
    (v_result ->> 'success') IS DISTINCT FROM 'true',
    'teacher cannot list topup inbox'
  );

  RAISE NOTICE 'R2 channel / QR / topup tests passed';
END;
$$;

ROLLBACK;
