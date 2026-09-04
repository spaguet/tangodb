-- FB6 / P1-13, P1-14, P3-04: bootstrap profile + server_now, wallet entry direction/balance_after.
-- Run: npm run test:db:renter-miniapp-fb6

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

CREATE OR REPLACE FUNCTION _fb6_set_renter_jwt(p_user uuid, p_org uuid, p_telegram bigint)
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
  v_org uuid := 'fb600000-0000-4000-8000-000000000001';
  v_user uuid := 'fb600000-0000-4000-8000-000000000011';
  v_member uuid := 'fb600000-0000-4000-8000-000000000021';
  v_renter_user uuid := 'fb600000-0000-4000-8000-000000000013';
  v_renter uuid := 'fb600000-0000-4000-8000-000000000041';
  v_result jsonb;
  v_entry jsonb;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES
    (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'fb6-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_renter_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'fb6-renter@users.invalid', crypt('testpass123', gen_salt('bf')), now(), now(), now(),
     jsonb_build_object('actor', 'renter', 'organization_id', v_org::text, 'telegram_id', '660001'),
     '{}'::jsonb)
  ON CONFLICT (id) DO UPDATE SET raw_app_meta_data = EXCLUDED.raw_app_meta_data;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'FB6 Profile Org', 'fb6-profile', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed', owner_user_id = EXCLUDED.owner_user_id;

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET license_type = 'lifetime', activated_at = now();

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'FB6 Owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, currency_code, locale)
  VALUES (v_org, 'Europe/Moscow', 'RUB', 'ru')
  ON CONFLICT (organization_id) DO UPDATE SET timezone = EXCLUDED.timezone;

  INSERT INTO renters (id, organization_id, display_name, contact_phone, status, telegram_id)
  VALUES (v_renter, v_org, 'Иван Тестов', '+79990001122', 'active', 660001)
  ON CONFLICT (id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    contact_phone = EXCLUDED.contact_phone,
    status = 'active',
    telegram_id = EXCLUDED.telegram_id;

  INSERT INTO organization_addons (organization_id, addon_code, status, period_start, period_end)
  VALUES (v_org, 'renter_miniapp', 'active', CURRENT_DATE - 1, CURRENT_DATE + 365)
  ON CONFLICT (organization_id, addon_code) DO UPDATE SET status = 'active';

  PERFORM _fb6_set_renter_jwt(v_renter_user, v_org, 660001);

  v_result := renter_bootstrap();
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'bootstrap success');
  PERFORM _test_assert(v_result ->> 'display_name' = 'Иван Тестов', 'bootstrap display_name');
  PERFORM _test_assert(v_result ->> 'contact_phone' = '+79990001122', 'bootstrap contact_phone');
  PERFORM _test_assert(v_result ? 'server_now', 'bootstrap server_now present');
  PERFORM _test_assert(
    abs(extract(epoch from (v_result ->> 'server_now')::timestamptz - now())) < 5,
    'bootstrap server_now near now'
  );

  INSERT INTO renter_wallet_ledger (organization_id, renter_id, entry_type, amount, created_at)
  VALUES (v_org, v_renter, 'topup', 100, now() - interval '2 minutes');

  INSERT INTO renter_wallet_ledger (organization_id, renter_id, entry_type, amount, created_at)
  VALUES (v_org, v_renter, 'prepay_charge', 40, now() - interval '1 minute');

  v_result := renter_get_wallet(10, 0);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'wallet success');
  PERFORM _test_assert(jsonb_array_length(v_result -> 'entries') = 2, 'wallet two entries');

  v_entry := (v_result -> 'entries') -> 0;
  PERFORM _test_assert(v_entry ->> 'direction' = 'debit', 'latest entry debit');
  PERFORM _test_assert((v_entry ->> 'balance_after')::numeric = 60, 'latest balance_after 60');

  v_entry := (v_result -> 'entries') -> 1;
  PERFORM _test_assert(v_entry ->> 'direction' = 'credit', 'older entry credit');
  PERFORM _test_assert((v_entry ->> 'balance_after')::numeric = 100, 'older balance_after 100');

  PERFORM _test_assert(_renter_wallet_entry_direction('topup') = 'credit', 'direction helper credit');
  PERFORM _test_assert(_renter_wallet_entry_direction('debt_settle') = 'debit', 'direction helper debit');

  RAISE NOTICE 'FB6 profile/wallet read model tests passed';
END;
$$;

ROLLBACK;
