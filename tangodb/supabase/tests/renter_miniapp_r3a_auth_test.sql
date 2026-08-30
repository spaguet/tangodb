-- R3a: mint prepare/bind, renter staff JWT inventory, dialog allows_write without bot_started.
-- Run after renter_miniapp_r2_channel_topup_test.sql fixtures or standalone (creates org).

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

CREATE OR REPLACE FUNCTION _r3a_set_renter_jwt(p_user uuid, p_org uuid, p_telegram bigint)
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
        'renter_id', '00000000-0000-4000-8000-0000000000aa',
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
  v_org uuid := 'a0a00000-0000-4000-8000-000000000001';
  v_user uuid := 'a0a00000-0000-4000-8000-000000000011';
  v_renter_user uuid := 'a0a00000-0000-4000-8000-000000000013';
  v_member uuid := 'a0a00000-0000-4000-8000-000000000021';
  v_renter uuid := 'a0a00000-0000-4000-8000-000000000041';
  v_loc uuid := 'a0a00000-0000-4000-8000-000000000031';
  v_result jsonb;
  v_raised boolean;
  v_n integer;
  v_started timestamptz;
  v_allows boolean;
BEGIN
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
      'r3a-owner@test.local',
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
    'r3a-renter@users.invalid',
    crypt('testpass123', gen_salt('bf')),
    now(), now(), now(),
    jsonb_build_object('actor', 'renter', 'organization_id', v_org::text),
    '{}'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'R3a Org', 'r3a-org', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, currency_code, locale)
  VALUES (v_org, 'Europe/Moscow', 'RUB', 'ru')
  ON CONFLICT (organization_id) DO NOTHING;

  INSERT INTO organization_members (id, organization_id, user_id, role, is_active)
  VALUES (v_member, v_org, v_user, 'owner', true)
  ON CONFLICT DO NOTHING;

  INSERT INTO locations (id, organization_id, name, is_active, miniapp_enabled)
  VALUES (v_loc, v_org, 'R3a Hall', true, false)
  ON CONFLICT DO NOTHING;

  INSERT INTO organization_renter_channel (organization_id, encrypted_bot_token, telegram_bot_id, bot_username)
  VALUES (v_org, decode(repeat('ab', 32), 'hex'), 999001, 'r3a_bot')
  ON CONFLICT (organization_id) DO UPDATE SET
    encrypted_bot_token = EXCLUDED.encrypted_bot_token,
    telegram_bot_id = EXCLUDED.telegram_bot_id;

  -- Mint channel lookup
  v_result := renter_telegram_mint_channel(v_org);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'mint channel for org');

  -- INSERT new renter without add-on → forbidden
  DELETE FROM organization_addons WHERE organization_id = v_org;
  v_result := renter_telegram_mint_prepare(jsonb_build_object(
    'organization_id', v_org,
    'telegram_id', '94001',
    'display_name', 'New Renter',
    'init_data_hash', 'hash_new_no_addon',
    'allows_write_to_pm', true
  ));
  PERFORM _test_assert(
    (v_result ->> 'success') IS DISTINCT FROM 'true',
    'INSERT without add-on rejected'
  );

  -- Active add-on → INSERT ok
  INSERT INTO organization_addons (organization_id, addon_code, status, period_start, period_end)
  VALUES (v_org, 'renter_miniapp', 'active', CURRENT_DATE - 1, CURRENT_DATE + 30)
  ON CONFLICT DO NOTHING;

  v_result := renter_telegram_mint_prepare(jsonb_build_object(
    'organization_id', v_org,
    'telegram_id', '94001',
    'display_name', 'New Renter',
    'init_data_hash', 'hash_new_with_addon',
    'allows_write_to_pm', true
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'INSERT with active add-on');
  PERFORM _test_assert((v_result ->> 'needs_create_user')::boolean, 'new card needs auth user');

  SELECT d.bot_started_at, d.allows_write_to_pm
  INTO v_started, v_allows
  FROM renter_telegram_dialog d
  WHERE d.organization_id = v_org AND d.telegram_id = 94001;
  PERFORM _test_assert(v_started IS NULL, 'allows_write from mint does not set bot_started');
  PERFORM _test_assert(v_allows IS TRUE, 'allows_write persisted on dialog');

  -- Idempotent hash
  v_result := renter_telegram_mint_prepare(jsonb_build_object(
    'organization_id', v_org,
    'telegram_id', '94001',
    'display_name', 'Ignored',
    'init_data_hash', 'hash_new_with_addon',
    'allows_write_to_pm', false
  ));
  PERFORM _test_assert((v_result ->> 'idempotent')::boolean, 'same hash idempotent');

  -- Existing renter without add-on (after delete addon row)
  INSERT INTO renters (id, organization_id, display_name, telegram_id, counterparty_type, status, auth_user_id)
  VALUES (v_renter, v_org, 'Existing R3a', 94002, 'individual', 'active', v_renter_user)
  ON CONFLICT (id) DO UPDATE SET
    telegram_id = 94002,
    auth_user_id = v_renter_user;

  DELETE FROM organization_addons WHERE organization_id = v_org;

  v_result := renter_telegram_mint_prepare(jsonb_build_object(
    'organization_id', v_org,
    'telegram_id', '94002',
    'display_name', 'Existing',
    'init_data_hash', 'hash_existing_no_addon'
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'existing renter mint without add-on');

  -- bind_auth race helper
  v_result := renter_telegram_mint_bind_auth(jsonb_build_object(
    'organization_id', v_org,
    'telegram_id', '94001',
    'auth_user_id', v_renter_user
  ));
  PERFORM _test_assert((v_result ->> 'bound')::boolean, 'bind_auth when null');

  -- renter JWT staff RPC
  PERFORM _r3a_set_renter_jwt(v_renter_user, v_org, 94002);
  v_raised := false;
  BEGIN
    PERFORM set_active_organization(v_org);
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
  END;
  PERFORM _test_assert(v_raised, 'renter JWT set_active_organization rejected');

  v_result := get_renter_detail(v_renter);
  PERFORM _test_assert(
    (v_result ->> 'success') IS DISTINCT FROM 'true',
    'renter JWT cannot get_renter_detail'
  );

  v_result := create_rental(jsonb_build_object(
    'location_id', v_loc,
    'renter_id', v_renter,
    'rental_date', CURRENT_DATE + 2,
    'time_start', '12:00',
    'time_end', '13:00'
  ));
  PERFORM _test_assert(
    (v_result ->> 'success') IS DISTINCT FROM 'true',
    'renter JWT cannot create_rental'
  );

  SELECT count(*) INTO v_n FROM clients WHERE organization_id = v_org;
  PERFORM _test_assert(v_n = 0, 'renter JWT SELECT clients empty via RLS');

  SELECT count(*) INTO v_n FROM financial_debtors_v;
  PERFORM _test_assert(v_n = 0, 'renter JWT financial_debtors_v empty');

  RAISE NOTICE 'renter_miniapp_r3a_auth_test: OK';
END;
$$;

ROLLBACK;
