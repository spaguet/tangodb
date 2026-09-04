-- FC1: correlation code on submit, inbox search, pending read model.

BEGIN;

\ir _hall_rent_test_jwt.sql

DO $$
DECLARE
  v_version_id uuid;
  v_org uuid := 'fc100000-0000-4000-8000-000000000001';
  v_renter uuid := 'fc100000-0000-4000-8000-000000000011';
  v_renter_user uuid := 'fc100000-0000-4000-8000-000000000021';
  v_owner_user uuid := 'fc100000-0000-4000-8000-000000000031';
  v_owner_member uuid := 'fc100000-0000-4000-8000-000000000041';
  v_qr uuid := 'fc100000-0000-4000-8000-000000000051';
  v_result jsonb;
  v_code_a text;
  v_code_b text;
  v_req_a uuid;
  v_req_b uuid;
  v_items jsonb;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES
    (
      v_owner_user,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'fc1-owner@test.local',
      crypt('testpass123', gen_salt('bf')),
      now(), now(), now(),
      '{}'::jsonb,
      '{}'::jsonb
    ),
    (
      v_renter_user,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'fc1-renter@users.invalid',
      crypt('testpass123', gen_salt('bf')),
      now(), now(), now(),
      jsonb_build_object('actor', 'renter', 'organization_id', v_org::text, 'telegram_id', '88001'),
      '{}'::jsonb
    )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'FC1 Org', 'fc1-org', 'licensed', v_version_id, v_owner_user)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed', owner_user_id = EXCLUDED.owner_user_id;

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET license_type = 'lifetime', activated_at = now();

  INSERT INTO organization_settings (organization_id, timezone, currency_code, locale)
  VALUES (v_org, 'Europe/Moscow', 'RUB', 'ru')
  ON CONFLICT (organization_id) DO NOTHING;

  INSERT INTO organization_addons (organization_id, addon_code, status, period_start, period_end)
  VALUES (v_org, 'renter_miniapp', 'active', CURRENT_DATE - 1, CURRENT_DATE + 365)
  ON CONFLICT (organization_id, addon_code) DO UPDATE SET status = 'active';

  INSERT INTO organization_members (id, organization_id, user_id, role, is_active)
  VALUES (v_owner_member, v_org, v_owner_user, 'owner', true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO renters (id, organization_id, display_name, status, counterparty_type, telegram_id, auth_user_id)
  VALUES (v_renter, v_org, 'FC1 Renter', 'active', 'individual', 88001, v_renter_user)
  ON CONFLICT (id) DO UPDATE SET
    telegram_id = EXCLUDED.telegram_id,
    auth_user_id = EXCLUDED.auth_user_id,
    status = 'active';

  INSERT INTO organization_renter_channel (
    organization_id, encrypted_bot_token, telegram_bot_id, bot_username, telegram_chat_url
  )
  VALUES (v_org, decode(repeat('ab', 32), 'hex'), 999101, 'fc1_bot', 'https://t.me/fc1_studio_chat')
  ON CONFLICT (organization_id) DO UPDATE SET
    encrypted_bot_token = EXCLUDED.encrypted_bot_token,
    telegram_bot_id = EXCLUDED.telegram_bot_id,
    telegram_chat_url = EXCLUDED.telegram_chat_url;

  INSERT INTO renter_telegram_dialog (organization_id, telegram_id, allows_write_to_pm)
  VALUES (v_org, 88001, true)
  ON CONFLICT (organization_id, telegram_id) DO UPDATE
    SET allows_write_to_pm = EXCLUDED.allows_write_to_pm;

  INSERT INTO organization_rental_qr_assets (id, organization_id, label, storage_path, mime_type, file_size, is_active)
  VALUES (v_qr, v_org, 'Main QR', 'fc1/main.png', 'image/png', 120, true)
  ON CONFLICT (id) DO NOTHING;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_renter_user::text,
    'app_metadata', json_build_object('actor', 'renter', 'organization_id', v_org, 'renter_id', v_renter, 'telegram_id', 88001)
  )::text, true);

  v_result := renter_submit_topup(jsonb_build_object('amount', 100, 'method', 'cash'));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'submit cash');
  v_req_a := (v_result ->> 'id')::uuid;
  v_code_a := v_result ->> 'correlation_code';
  PERFORM _test_assert(v_code_a ~ '^TDB-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$', 'code format A');

  v_result := renter_get_wallet(20, 0);
  PERFORM _test_assert(
    v_result -> 'pending_topup' ->> 'correlation_code' = v_code_a,
    'wallet pending correlation_code'
  );

  PERFORM _hall_rent_test_set_jwt(v_owner_user, v_org, v_owner_member, 'owner');
  v_result := resolve_renter_topup(jsonb_build_object(
    'id', v_req_a,
    'action', 'confirm',
    'idempotency_key', gen_random_uuid()
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'confirm A');

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_renter_user::text,
    'app_metadata', json_build_object('actor', 'renter', 'organization_id', v_org, 'renter_id', v_renter, 'telegram_id', 88001)
  )::text, true);

  v_result := renter_submit_topup(jsonb_build_object(
    'amount', 200, 'method', 'qr', 'qr_asset_id', v_qr
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'submit qr B');
  v_req_b := (v_result ->> 'id')::uuid;
  v_code_b := v_result ->> 'correlation_code';
  PERFORM _test_assert(v_code_b IS DISTINCT FROM v_code_a, 'distinct codes');

  PERFORM _hall_rent_test_set_jwt(v_owner_user, v_org, v_owner_member, 'owner');

  v_result := list_renter_topup_inbox('pending', 50, 0, v_code_b);
  v_items := v_result -> 'items';
  PERFORM _test_assert(
    jsonb_array_length(v_items) = 1
    AND (v_items -> 0 ->> 'correlation_code') = v_code_b
    AND (v_items -> 0 ->> 'id')::uuid = v_req_b,
    'inbox search by correlation code'
  );
  PERFORM _test_assert(
    (v_items -> 0 ->> 'qr_storage_path') IS NULL
    AND (v_items -> 0 ->> 'qr_signed_url') IS NULL,
    'inbox rows omit QR preview fields'
  );

  v_result := list_renter_topup_inbox('all', 50, 0, 'FC1 Renter');
  PERFORM _test_assert((v_result ->> 'total')::integer >= 2, 'inbox search by renter name');

  RAISE NOTICE 'FC1 correlation code tests passed';
END;
$$;

ROLLBACK;
