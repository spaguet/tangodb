-- FB3 / P1-04 (show), P1-05: renter_get_wallet pending_topup + has_awaiting_payment read model.
-- Run: npm run test:db:renter-miniapp-fb3

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

CREATE OR REPLACE FUNCTION _fb3_set_renter_jwt(p_user uuid, p_org uuid, p_telegram bigint)
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

CREATE OR REPLACE FUNCTION _fb3_slot_at(p_org uuid, p_ahead interval)
RETURNS TABLE (d date, ts text, te text)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_local timestamp;
  v_tz text;
BEGIN
  v_tz := _org_timezone(p_org);
  v_local := date_trunc('hour', (now() AT TIME ZONE v_tz) + p_ahead);
  IF EXTRACT(MINUTE FROM ((now() AT TIME ZONE v_tz) + p_ahead)) > 0 THEN
    v_local := v_local + interval '1 hour';
  END IF;
  IF EXTRACT(HOUR FROM v_local) >= 22 THEN
    v_local := date_trunc('day', v_local) + interval '1 day' + interval '18 hours';
  END IF;
  IF EXTRACT(HOUR FROM v_local) < 8 THEN
    v_local := date_trunc('day', v_local) + interval '18 hours';
  END IF;
  d := v_local::date;
  ts := to_char(v_local, 'HH24:MI');
  te := to_char(v_local + interval '1 hour', 'HH24:MI');
  RETURN NEXT;
END;
$$;

DO $$
DECLARE
  v_version_id uuid;
  v_org uuid := 'fb300000-0000-4000-8000-000000000001';
  v_user uuid := 'fb300000-0000-4000-8000-000000000011';
  v_member uuid := 'fb300000-0000-4000-8000-000000000021';
  v_renter_user uuid := 'fb300000-0000-4000-8000-000000000013';
  v_loc uuid := 'fb300000-0000-4000-8000-0000000000aa';
  v_renter uuid := 'fb300000-0000-4000-8000-000000000041';
  v_far date;
  v_far_ts text;
  v_far_te text;
  v_result jsonb;
  v_req uuid;
  v_rental uuid;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES
    (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'fb3-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_renter_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'fb3-renter@users.invalid', crypt('testpass123', gen_salt('bf')), now(), now(), now(),
     jsonb_build_object('actor', 'renter', 'organization_id', v_org::text, 'telegram_id', '97001'),
     '{}'::jsonb)
  ON CONFLICT (id) DO UPDATE SET raw_app_meta_data = EXCLUDED.raw_app_meta_data;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'FB3 Pending Org', 'fb3-pending', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed', owner_user_id = EXCLUDED.owner_user_id;

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET license_type = 'lifetime', activated_at = now();

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'FB3 Owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, currency_code, locale)
  VALUES (v_org, 'Europe/Moscow', 'RUB', 'ru')
  ON CONFLICT (organization_id) DO UPDATE SET timezone = EXCLUDED.timezone;

  INSERT INTO locations (id, organization_id, name, miniapp_enabled)
  VALUES (v_loc, v_org, 'FB3 Hall', true)
  ON CONFLICT (id) DO UPDATE SET miniapp_enabled = true;

  INSERT INTO renters (id, organization_id, display_name, status, telegram_id)
  VALUES (v_renter, v_org, 'FB3 Renter', 'active', 97001)
  ON CONFLICT (id) DO UPDATE SET status = 'active', telegram_id = EXCLUDED.telegram_id;

  INSERT INTO organization_addons (organization_id, addon_code, status, period_start, period_end)
  VALUES (v_org, 'renter_miniapp', 'active', CURRENT_DATE - 1, CURRENT_DATE + 365)
  ON CONFLICT (organization_id, addon_code) DO UPDATE SET status = 'active';

  INSERT INTO location_rental_hour_rates (organization_id, location_id, kind, price, currency, valid_from)
  VALUES
    (v_org, v_loc, 'one_time', 1000, 'RUB', DATE '2000-01-01'),
    (v_org, v_loc, 'recurring', 800, 'RUB', DATE '2000-01-01'),
    (v_org, v_loc, 'penalty', 1500, 'RUB', DATE '2000-01-01')
  ON CONFLICT DO NOTHING;

  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');

  SELECT d, ts, te
  INTO v_far, v_far_ts, v_far_te
  FROM _fb3_slot_at(v_org, interval '72 hours');

  PERFORM _fb3_set_renter_jwt(v_renter_user, v_org, 97001);

  v_result := renter_get_wallet(10, 0);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'wallet baseline');
  PERFORM _test_assert(v_result -> 'pending_topup' IS NULL OR v_result ->> 'pending_topup' = 'null', 'no pending initially');
  PERFORM _test_assert((v_result ->> 'has_awaiting_payment')::boolean IS FALSE, 'no awaiting initially');

  v_result := renter_submit_topup(jsonb_build_object('amount', 250, 'method', 'cash'));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'submit_topup cash');
  v_req := (v_result ->> 'id')::uuid;

  v_result := renter_get_wallet(10, 0);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'wallet with pending');
  PERFORM _test_assert((v_result -> 'pending_topup' ->> 'id')::uuid = v_req, 'pending_topup id');
  PERFORM _test_assert((v_result -> 'pending_topup' ->> 'amount')::numeric = 250, 'pending_topup amount');
  PERFORM _test_assert(v_result -> 'pending_topup' ->> 'method' = 'cash', 'pending_topup method');
  PERFORM _test_assert(v_result -> 'pending_topup' ->> 'created_at' IS NOT NULL, 'pending_topup created_at');

  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');
  v_result := resolve_renter_topup(jsonb_build_object(
    'id', v_req,
    'action', 'confirm',
    'idempotency_key', gen_random_uuid()
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'confirm topup: ' || COALESCE(v_result ->> 'error', 'ok'));

  PERFORM _fb3_set_renter_jwt(v_renter_user, v_org, 97001);
  v_result := renter_get_wallet(10, 0);
  PERFORM _test_assert(v_result -> 'pending_topup' IS NULL OR v_result ->> 'pending_topup' = 'null', 'pending cleared after confirm');

  -- Drain wallet to force awaiting_payment hold
  DELETE FROM renter_wallet_ledger WHERE organization_id = v_org AND renter_id = v_renter;

  v_result := renter_create_booking(jsonb_build_object(
    'location_id', v_loc,
    'rental_date', v_far,
    'time_start', v_far_ts,
    'time_end', v_far_te,
    'idempotency_key', 'fb3-hold'
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'create hold: ' || COALESCE(v_result ->> 'error', 'ok'));
  v_rental := (v_result -> 'rental' ->> 'id')::uuid;

  v_result := renter_get_wallet(10, 0);
  PERFORM _test_assert((v_result ->> 'has_awaiting_payment')::boolean, 'has_awaiting_payment true');

  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');
  v_result := renter_delete_hold(v_rental);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'delete hold cleanup');

  PERFORM _fb3_set_renter_jwt(v_renter_user, v_org, 97001);
  v_result := renter_get_wallet(10, 0);
  PERFORM _test_assert((v_result ->> 'has_awaiting_payment')::boolean IS FALSE, 'has_awaiting_payment false after delete');

  RAISE NOTICE 'FB3 pending wallet read model tests passed';
END;
$$;

ROLLBACK;
