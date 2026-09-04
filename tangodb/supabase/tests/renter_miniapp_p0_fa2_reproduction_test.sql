-- FA2: P0-01 staff-topup idempotency (lost-response retry + same-key + payload conflict).
-- Run: npm run test:db:renter-miniapp-p0-fa2
-- Or: psql ... -f supabase/tests/_hall_rent_test_jwt.sql -f supabase/tests/renter_miniapp_p0_fa2_reproduction_test.sql

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
  v_org uuid := 'a0f00000-0000-4000-8000-000000000001';
  v_user uuid := 'a0f00000-0000-4000-8000-000000000011';
  v_member uuid := 'a0f00000-0000-4000-8000-000000000021';
  v_renter uuid := 'a0f00000-0000-4000-8000-000000000041';
  v_key uuid;
  v_result jsonb;
  v_balance numeric;
  v_n int;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES (
    v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'p0-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(),
    '{}'::jsonb, '{}'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'P0 Repro Org', 'p0-repro', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed', owner_user_id = EXCLUDED.owner_user_id;

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET license_type = 'lifetime', activated_at = now();

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'P0 Owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, currency_code, locale)
  VALUES (v_org, 'Europe/Moscow', 'RUB', 'ru')
  ON CONFLICT (organization_id) DO UPDATE SET
    timezone = EXCLUDED.timezone,
    currency_code = EXCLUDED.currency_code;

  INSERT INTO renters (id, organization_id, display_name, status)
  VALUES (v_renter, v_org, 'P0 Topup Renter', 'active')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization_addons (organization_id, addon_code, status, period_start, period_end)
  VALUES (v_org, 'renter_miniapp', 'active', CURRENT_DATE - 1, CURRENT_DATE + 365)
  ON CONFLICT (organization_id, addon_code) DO UPDATE SET
    status = 'active', period_start = EXCLUDED.period_start, period_end = EXCLUDED.period_end;

  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');

  -- P0-01 lost-response: retry with the SAME key after first success
  v_key := gen_random_uuid();

  v_result := staff_renter_wallet_topup(jsonb_build_object(
    'renter_id', v_renter,
    'amount', 100,
    'method', 'cash',
    'idempotency_key', v_key
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'P0-01 lost-response: first topup ok');

  v_result := staff_renter_wallet_topup(jsonb_build_object(
    'renter_id', v_renter,
    'amount', 100,
    'method', 'cash',
    'idempotency_key', v_key
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'P0-01 lost-response: retry topup ok');
  PERFORM _test_assert(
    COALESCE((v_result ->> 'already_applied')::boolean, false),
    'P0-01 lost-response: retry returns already_applied'
  );

  v_balance := _renter_wallet_balance(v_org, v_renter);
  SELECT count(*) INTO v_n
  FROM renter_wallet_ledger
  WHERE renter_id = v_renter AND entry_type = 'topup' AND topup_request_id IS NULL;

  PERFORM _test_assert(v_balance = 100, 'P0-01 lost-response: balance +100 only (got ' || v_balance || ')');
  PERFORM _test_assert(v_n = 1, 'P0-01 lost-response: one staff topup ledger row (got ' || v_n || ')');

  -- P0-01 same-key serialized retry (parallel race — FA7)
  DELETE FROM renter_wallet_ledger WHERE renter_id = v_renter;
  DELETE FROM rental_advances WHERE renter_id = v_renter;
  DELETE FROM operation_idempotency
  WHERE organization_id = v_org AND scope = 'staff_renter_wallet_topup';

  v_key := gen_random_uuid();
  v_result := staff_renter_wallet_topup(jsonb_build_object(
    'renter_id', v_renter,
    'amount', 150,
    'method', 'cash',
    'idempotency_key', v_key
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'P0-01 same-key: first topup ok');

  v_result := staff_renter_wallet_topup(jsonb_build_object(
    'renter_id', v_renter,
    'amount', 150,
    'method', 'cash',
    'idempotency_key', v_key
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'P0-01 same-key: second topup idempotent');

  v_balance := _renter_wallet_balance(v_org, v_renter);
  SELECT count(*) INTO v_n
  FROM renter_wallet_ledger
  WHERE renter_id = v_renter AND entry_type = 'topup' AND topup_request_id IS NULL;

  PERFORM _test_assert(v_balance = 150, 'P0-01 same-key: balance +150 only (got ' || v_balance || ')');
  PERFORM _test_assert(v_n = 1, 'P0-01 same-key: one staff topup ledger row (got ' || v_n || ')');

  -- P0-01 payload mismatch on same key
  v_result := staff_renter_wallet_topup(jsonb_build_object(
    'renter_id', v_renter,
    'amount', 200,
    'method', 'cash',
    'idempotency_key', v_key
  ));
  PERFORM _test_assert(
    (v_result ->> 'success') IS DISTINCT FROM 'true',
    'P0-01 payload mismatch: must not succeed'
  );
  PERFORM _test_assert(
    v_result ->> 'error_code' = 'idempotency_conflict',
    'P0-01 payload mismatch: idempotency_conflict (got ' || COALESCE(v_result ->> 'error_code', v_result ->> 'error') || ')'
  );

  v_balance := _renter_wallet_balance(v_org, v_renter);
  PERFORM _test_assert(v_balance = 150, 'P0-01 payload mismatch: balance unchanged (got ' || v_balance || ')');

  RAISE NOTICE 'renter_miniapp_p0_fa2_reproduction_test: P0-01 invariants passed';
END;
$$;

ROLLBACK;
