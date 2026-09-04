-- FE5: auth replay vs suspension, QR chat gate, bind race, webhook private context.
-- Run: psql ON_ERROR_STOP + _hall_rent_test_jwt.sql

BEGIN;

CREATE OR REPLACE FUNCTION _fe5_assert(p_condition boolean, p_message text)
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
  v_org uuid := 'a0f50000-0000-4000-8000-000000000001';
  v_user uuid := 'a0f50000-0000-4000-8000-000000000011';
  v_renter_user uuid := 'a0f50000-0000-4000-8000-000000000013';
  v_member uuid := 'a0f50000-0000-4000-8000-000000000021';
  v_renter uuid := 'a0f50000-0000-4000-8000-000000000041';
  v_loc uuid := 'a0f50000-0000-4000-8000-000000000031';
  v_qr uuid := 'a0f50000-0000-4000-8000-000000000051';
  v_result jsonb;
  v_started timestamptz;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);

  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES
    (
      v_user,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'fe5-owner@test.local',
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
      'fe5-renter@users.invalid',
      crypt('testpass123', gen_salt('bf')),
      now(), now(), now(),
      jsonb_build_object('actor', 'renter', 'organization_id', v_org::text),
      '{}'::jsonb
    )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'FE5 Org', 'fe5-org', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed', owner_user_id = EXCLUDED.owner_user_id;

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET license_type = 'lifetime', activated_at = now();

  INSERT INTO organization_settings (organization_id, timezone, currency_code, locale)
  VALUES (v_org, 'Europe/Moscow', 'RUB', 'ru')
  ON CONFLICT (organization_id) DO NOTHING;

  INSERT INTO organization_members (id, organization_id, user_id, role, is_active)
  VALUES (v_member, v_org, v_user, 'owner', true)
  ON CONFLICT DO NOTHING;

  INSERT INTO locations (id, organization_id, name, miniapp_enabled)
  VALUES (v_loc, v_org, 'FE5 Hall', true)
  ON CONFLICT DO NOTHING;

  INSERT INTO organization_renter_channel (organization_id, encrypted_bot_token, telegram_bot_id, bot_username)
  VALUES (v_org, decode(repeat('cd', 32), 'hex'), 999501, 'fe5_bot')
  ON CONFLICT (organization_id) DO UPDATE SET
    encrypted_bot_token = EXCLUDED.encrypted_bot_token,
    telegram_bot_id = EXCLUDED.telegram_bot_id;

  INSERT INTO renters (id, organization_id, display_name, telegram_id, counterparty_type, status, auth_user_id)
  VALUES (v_renter, v_org, 'FE5 Renter', 95001, 'individual', 'active', v_renter_user)
  ON CONFLICT (id) DO UPDATE SET telegram_id = 95001, auth_user_id = v_renter_user;

  INSERT INTO organization_rental_qr_assets (
    id, organization_id, storage_path, mime_type, file_size, is_active
  )
  VALUES (v_qr, v_org, v_org::text || '/qr-fe5.png', 'image/png', 120, true)
  ON CONFLICT (id) DO NOTHING;

  -- Mint prepare + hash row for replay test
  v_result := renter_telegram_mint_prepare(jsonb_build_object(
    'organization_id', v_org,
    'telegram_id', '95001',
    'display_name', 'FE5',
    'init_data_hash', 'fe5_hash_replay',
    'allows_write_to_pm', true
  ));
  PERFORM _fe5_assert((v_result ->> 'success')::boolean, 'initial mint prepare');

  UPDATE organizations SET status = 'demo_retention' WHERE id = v_org;

  v_result := renter_telegram_mint_prepare(jsonb_build_object(
    'organization_id', v_org,
    'telegram_id', '95001',
    'display_name', 'Ignored',
    'init_data_hash', 'fe5_hash_replay',
    'allows_write_to_pm', false
  ));
  PERFORM _fe5_assert(
    (v_result ->> 'success') IS DISTINCT FROM 'true',
    'idempotent replay rejected when org suspended'
  );

  UPDATE organizations SET status = 'licensed' WHERE id = v_org;

  -- bind_auth: existing winner is not overwritten
  v_result := renter_telegram_mint_bind_auth(jsonb_build_object(
    'organization_id', v_org,
    'telegram_id', '95001',
    'auth_user_id', '00000000-0000-4000-8000-000000000099'
  ));
  PERFORM _fe5_assert((v_result ->> 'bound')::boolean IS FALSE, 'bind lost race returns bound=false');
  PERFORM _fe5_assert(
    (v_result ->> 'existing_auth_user_id') = v_renter_user::text,
    'bind returns existing winner auth_user_id'
  );
  PERFORM _fe5_assert(
    (SELECT auth_user_id FROM renters WHERE id = v_renter) = v_renter_user,
    'bind does not replace existing auth_user_id'
  );

  -- Webhook ingest: non-start payload (as edge sends for group updates) must not set bot_started
  v_result := renter_telegram_webhook_ingest(jsonb_build_object(
    'organization_id', v_org,
    'telegram_id', '95002',
    'telegram_bot_id', '999501',
    'update_id', '950201',
    'is_start', false,
    'allows_write', null
  ));
  PERFORM _fe5_assert((v_result ->> 'success')::boolean, 'ingest rpc accepts payload');
  SELECT d.bot_started_at INTO v_started
  FROM renter_telegram_dialog d
  WHERE d.organization_id = v_org AND d.telegram_id = 95002;
  PERFORM _fe5_assert(v_started IS NULL, 'non-start ingest does not set bot_started');

  -- Simulate edge: group context would send is_start=false after FE5 classifier
  v_result := renter_telegram_webhook_ingest(jsonb_build_object(
    'organization_id', v_org,
    'telegram_id', '95003',
    'telegram_bot_id', '999501',
    'update_id', '950301',
    'is_start', true,
    'allows_write', true
  ));
  SELECT d.bot_started_at INTO v_started
  FROM renter_telegram_dialog d
  WHERE d.organization_id = v_org AND d.telegram_id = 95003;
  PERFORM _fe5_assert(v_started IS NOT NULL, 'private start sets bot_started');

  -- QR topup without allowlisted chat
  PERFORM set_config('request.jwt.claim.sub', v_renter_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', v_renter_user::text,
      'role', 'authenticated',
      'app_metadata', json_build_object(
        'actor', 'renter',
        'organization_id', v_org::text,
        'renter_id', v_renter::text,
        'telegram_id', '95001'
      )
    )::text,
    true
  );

  v_result := renter_submit_topup(jsonb_build_object(
    'amount', 100,
    'method', 'qr',
    'qr_asset_id', v_qr
  ));
  PERFORM _fe5_assert(
    v_result ->> 'error' = 'renter.topup.chatRequired',
    'qr topup blocked without allowlisted chat'
  );

  UPDATE organization_renter_channel
  SET telegram_chat_url = 'https://t.me/fe5studio'
  WHERE organization_id = v_org;

  v_result := renter_submit_topup(jsonb_build_object(
    'amount', 100,
    'method', 'cash'
  ));
  PERFORM _fe5_assert((v_result ->> 'success')::boolean, 'cash topup allowed without chat');

  RAISE NOTICE 'renter_miniapp_fe5_auth_webhook_test: OK';
END;
$$;

ROLLBACK;
