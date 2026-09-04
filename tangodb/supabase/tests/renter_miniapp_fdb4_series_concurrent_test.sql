-- FDB4 / §9 variant B: load, expiry- and concurrent SQL tests for pack series.
-- Run: npm run test:db:renter-miniapp-fdb4

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

CREATE OR REPLACE FUNCTION _fdb4_pack_slot(p_org uuid, p_ahead interval)
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

CREATE OR REPLACE FUNCTION _fdb4_find_pack_monday(p_org uuid)
RETURNS TABLE (pack_from date, pack_to date, slot_ts text, slot_te text)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_win_from date;
  v_win_to date;
  v_from date;
  v_ts text;
  v_te text;
BEGIN
  SELECT window_start, window_end INTO v_win_from, v_win_to
  FROM _renter_occupancy_window(p_org);

  SELECT d, ts, te INTO v_from, v_ts, v_te
  FROM _fdb4_pack_slot(p_org, interval '72 hours');

  WHILE EXTRACT(ISODOW FROM v_from)::int NOT IN (1, 3, 5)
     OR v_from < v_win_from
     OR v_from > v_win_to
  LOOP
    v_from := v_from + 1;
    EXIT WHEN v_from > v_win_to;
  END LOOP;
  WHILE EXTRACT(ISODOW FROM v_from)::int <> 1 AND v_from <= v_win_to LOOP
    v_from := v_from + 1;
  END LOOP;

  pack_from := v_from;
  pack_to := v_from + 27;
  slot_ts := v_ts;
  slot_te := v_te;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION _test_fdb4_parallel_pack_create(p_renter_suffix text, p_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid := 'fdb40000-0000-4000-8000-000000000001';
  v_user uuid := 'fdb40000-0000-4000-8000-000000000011';
  v_member uuid := 'fdb40000-0000-4000-8000-000000000021';
  v_loc uuid := 'fdb40000-0000-4000-8000-0000000000aa';
  v_renter uuid;
  v_pack_from date;
  v_pack_to date;
  v_slot_ts text;
  v_slot_te text;
BEGIN
  v_renter := ('fdb40000-0000-4000-8000-0000000000' || p_renter_suffix)::uuid;

  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');

  SELECT pack_from, pack_to, slot_ts, slot_te
  INTO v_pack_from, v_pack_to, v_slot_ts, v_slot_te
  FROM _fdb4_find_pack_monday(v_org);

  RETURN renter_create_recurring_pack(jsonb_build_object(
    'renter_id', v_renter,
    'location_id', v_loc,
    'valid_from', v_pack_from,
    'valid_to', v_pack_to,
    'weekdays', jsonb_build_array(1, 3, 5),
    'time_start', v_slot_ts,
    'time_end', v_slot_te,
    'idempotency_key', p_key
  ));
END;
$$;

CREATE OR REPLACE FUNCTION _test_fdb4_expire_race_hold(p_sleep_seconds double precision DEFAULT 3)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid := 'fdb40000-0000-4000-8000-000000000002';
  v_renter uuid := 'fdb40000-0000-4000-8000-000000000051';
  v_key bigint;
BEGIN
  v_key := _renter_wallet_lock_key(v_org, v_renter);
  PERFORM pg_advisory_lock(v_key);
  PERFORM pg_sleep(p_sleep_seconds);
  UPDATE rental_series
  SET hold_expires_at = now() - interval '1 minute'
  WHERE organization_id = v_org
    AND renter_id = v_renter
    AND idempotency_key = 'fdb4-expire-race';
  UPDATE rentals
  SET hold_expires_at = now() - interval '1 minute'
  WHERE rental_series_id = (
    SELECT id FROM rental_series
    WHERE organization_id = v_org AND idempotency_key = 'fdb4-expire-race'
  );
  PERFORM _renter_expire_and_catchup(v_org, v_renter);
  PERFORM pg_advisory_unlock(v_key);
END;
$$;

CREATE OR REPLACE FUNCTION _test_fdb4_topup_race(p_amount numeric, p_key uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM _hall_rent_test_set_jwt(
    'fdb40000-0000-4000-8000-000000000011'::uuid,
    'fdb40000-0000-4000-8000-000000000002'::uuid,
    'fdb40000-0000-4000-8000-000000000022'::uuid,
    'owner'
  );
  RETURN staff_renter_wallet_topup(jsonb_build_object(
    'renter_id', 'fdb40000-0000-4000-8000-000000000051',
    'amount', p_amount,
    'method', 'cash',
    'idempotency_key', p_key
  ));
END;
$$;

CREATE OR REPLACE FUNCTION _test_fdb4_topup_race_cancel(p_amount numeric, p_key uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM _hall_rent_test_set_jwt(
    'fdb40000-0000-4000-8000-000000000011'::uuid,
    'fdb40000-0000-4000-8000-000000000003'::uuid,
    'fdb40000-0000-4000-8000-000000000023'::uuid,
    'owner'
  );
  RETURN staff_renter_wallet_topup(jsonb_build_object(
    'renter_id', 'fdb40000-0000-4000-8000-000000000061',
    'amount', p_amount,
    'method', 'cash',
    'idempotency_key', p_key
  ));
END;
$$;

CREATE OR REPLACE FUNCTION _test_fdb4_cancel_race()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid := 'fdb40000-0000-4000-8000-000000000003';
  v_user uuid := 'fdb40000-0000-4000-8000-000000000011';
  v_member uuid := 'fdb40000-0000-4000-8000-000000000023';
  v_series uuid;
BEGIN
  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');
  SELECT id INTO v_series
  FROM rental_series
  WHERE organization_id = v_org
    AND idempotency_key = 'fdb4-cancel-race';
  IF v_series IS NULL THEN
    RAISE EXCEPTION 'cancel-race series fixture missing';
  END IF;
  RETURN renter_cancel_pack(v_series);
END;
$$;

-- Committed fixtures for fdb4-concurrent-pack.mjs
DO $$
DECLARE
  v_version_id uuid;
  v_org uuid := 'fdb40000-0000-4000-8000-000000000001';
  v_user uuid := 'fdb40000-0000-4000-8000-000000000011';
  v_member uuid := 'fdb40000-0000-4000-8000-000000000021';
  v_loc uuid := 'fdb40000-0000-4000-8000-0000000000aa';
  v_renter_a uuid := 'fdb40000-0000-4000-8000-000000000041';
  v_renter_b uuid := 'fdb40000-0000-4000-8000-000000000042';
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES (
    v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'fdb4-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(),
    '{}'::jsonb, '{}'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'FDB4 Concurrent Org', 'fdb4-concurrent', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed', owner_user_id = EXCLUDED.owner_user_id;

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET license_type = 'lifetime', activated_at = now();

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'FDB4 Owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, currency_code, locale)
  VALUES (v_org, 'Europe/Moscow', 'RUB', 'ru')
  ON CONFLICT (organization_id) DO UPDATE SET timezone = EXCLUDED.timezone;

  INSERT INTO locations (id, organization_id, name, miniapp_enabled)
  VALUES (v_loc, v_org, 'FDB4 Hall', true)
  ON CONFLICT (id) DO UPDATE SET miniapp_enabled = true;

  INSERT INTO renters (id, organization_id, display_name, status, telegram_id)
  VALUES
    (v_renter_a, v_org, 'FDB4 Renter A', 'active', 98001),
    (v_renter_b, v_org, 'FDB4 Renter B', 'active', 98002)
  ON CONFLICT (id) DO UPDATE SET status = 'active';

  INSERT INTO organization_addons (organization_id, addon_code, status, period_start, period_end)
  VALUES (v_org, 'renter_miniapp', 'active', CURRENT_DATE - 1, CURRENT_DATE + 365)
  ON CONFLICT (organization_id, addon_code) DO UPDATE SET status = 'active';

  INSERT INTO location_rental_hour_rates (organization_id, location_id, kind, price, currency, valid_from)
  VALUES
    (v_org, v_loc, 'one_time', 1000, 'RUB', DATE '2000-01-01'),
    (v_org, v_loc, 'recurring', 1000, 'RUB', DATE '2000-01-01'),
    (v_org, v_loc, 'penalty', 1500, 'RUB', DATE '2000-01-01')
  ON CONFLICT DO NOTHING;

  DELETE FROM rentals WHERE organization_id = v_org;
  DELETE FROM rental_series WHERE organization_id = v_org;
  DELETE FROM renter_wallet_ledger WHERE organization_id = v_org;
  DELETE FROM operation_idempotency WHERE organization_id = v_org;

  INSERT INTO renter_wallet_ledger (organization_id, renter_id, entry_type, amount)
  VALUES
    (v_org, v_renter_a, 'topup', 400),
    (v_org, v_renter_b, 'topup', 50000);
END;
$$;

-- Expire-race fixture org
DO $$
DECLARE
  v_version_id uuid;
  v_org uuid := 'fdb40000-0000-4000-8000-000000000002';
  v_user uuid := 'fdb40000-0000-4000-8000-000000000011';
  v_member uuid := 'fdb40000-0000-4000-8000-000000000022';
  v_loc uuid := 'fdb40000-0000-4000-8000-0000000000ab';
  v_renter uuid := 'fdb40000-0000-4000-8000-000000000051';
  v_pack_from date;
  v_pack_to date;
  v_slot_ts text;
  v_slot_te text;
  v_result jsonb;
  v_total_prepay numeric;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'FDB4 Expire Race Org', 'fdb4-expire-race', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed';

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO NOTHING;

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'FDB4 Expire Owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, currency_code, locale)
  VALUES (v_org, 'Europe/Moscow', 'RUB', 'ru')
  ON CONFLICT (organization_id) DO NOTHING;

  INSERT INTO locations (id, organization_id, name, miniapp_enabled)
  VALUES (v_loc, v_org, 'FDB4 Expire Hall', true)
  ON CONFLICT (id) DO UPDATE SET miniapp_enabled = true;

  INSERT INTO renters (id, organization_id, display_name, status, telegram_id)
  VALUES (v_renter, v_org, 'FDB4 Expire Renter', 'active', 98051)
  ON CONFLICT (id) DO UPDATE SET status = 'active';

  INSERT INTO organization_addons (organization_id, addon_code, status, period_start, period_end)
  VALUES (v_org, 'renter_miniapp', 'active', CURRENT_DATE - 1, CURRENT_DATE + 365)
  ON CONFLICT (organization_id, addon_code) DO UPDATE SET status = 'active';

  INSERT INTO location_rental_hour_rates (organization_id, location_id, kind, price, currency, valid_from)
  VALUES
    (v_org, v_loc, 'one_time', 1000, 'RUB', DATE '2000-01-01'),
    (v_org, v_loc, 'recurring', 1000, 'RUB', DATE '2000-01-01'),
    (v_org, v_loc, 'penalty', 1500, 'RUB', DATE '2000-01-01')
  ON CONFLICT DO NOTHING;

  DELETE FROM rentals WHERE organization_id = v_org;
  DELETE FROM rental_series WHERE organization_id = v_org;
  DELETE FROM renter_wallet_ledger WHERE organization_id = v_org AND renter_id = v_renter;
  INSERT INTO renter_wallet_ledger (organization_id, renter_id, entry_type, amount)
  VALUES (v_org, v_renter, 'topup', 400);

  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');

  SELECT pack_from, pack_to, slot_ts, slot_te
  INTO v_pack_from, v_pack_to, v_slot_ts, v_slot_te
  FROM _fdb4_find_pack_monday(v_org);

  v_result := renter_create_recurring_pack(jsonb_build_object(
    'renter_id', v_renter,
    'location_id', v_loc,
    'valid_from', v_pack_from,
    'valid_to', v_pack_to,
    'weekdays', jsonb_build_array(1, 3, 5),
    'time_start', v_slot_ts,
    'time_end', v_slot_te,
    'idempotency_key', 'fdb4-expire-race'
  ));
  IF NOT (v_result ->> 'success')::boolean THEN
    RAISE EXCEPTION 'expire-race fixture pack create failed: %', v_result;
  END IF;

  SELECT COALESCE(sum(r.prepay_amount), 0)
  INTO v_total_prepay
  FROM rentals r
  JOIN rental_series rs ON rs.id = r.rental_series_id
  WHERE rs.organization_id = v_org AND rs.idempotency_key = 'fdb4-expire-race';
END;
$$;

-- Cancel-race fixture org
DO $$
DECLARE
  v_version_id uuid;
  v_org uuid := 'fdb40000-0000-4000-8000-000000000003';
  v_user uuid := 'fdb40000-0000-4000-8000-000000000011';
  v_member uuid := 'fdb40000-0000-4000-8000-000000000023';
  v_loc uuid := 'fdb40000-0000-4000-8000-0000000000bb';
  v_renter uuid := 'fdb40000-0000-4000-8000-000000000061';
  v_pack_from date;
  v_pack_to date;
  v_slot_ts text;
  v_slot_te text;
  v_result jsonb;
  v_total_prepay numeric;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'FDB4 Cancel Race Org', 'fdb4-cancel-race', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed';

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO NOTHING;

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'FDB4 Cancel Owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, currency_code, locale)
  VALUES (v_org, 'Europe/Moscow', 'RUB', 'ru')
  ON CONFLICT (organization_id) DO NOTHING;

  INSERT INTO locations (id, organization_id, name, miniapp_enabled)
  VALUES (v_loc, v_org, 'FDB4 Cancel Hall', true)
  ON CONFLICT (id) DO UPDATE SET miniapp_enabled = true;

  INSERT INTO renters (id, organization_id, display_name, status, telegram_id)
  VALUES (v_renter, v_org, 'FDB4 Cancel Renter', 'active', 98061)
  ON CONFLICT (id) DO UPDATE SET status = 'active';

  INSERT INTO organization_addons (organization_id, addon_code, status, period_start, period_end)
  VALUES (v_org, 'renter_miniapp', 'active', CURRENT_DATE - 1, CURRENT_DATE + 365)
  ON CONFLICT (organization_id, addon_code) DO UPDATE SET status = 'active';

  INSERT INTO location_rental_hour_rates (organization_id, location_id, kind, price, currency, valid_from)
  VALUES
    (v_org, v_loc, 'one_time', 1000, 'RUB', DATE '2000-01-01'),
    (v_org, v_loc, 'recurring', 1000, 'RUB', DATE '2000-01-01'),
    (v_org, v_loc, 'penalty', 1500, 'RUB', DATE '2000-01-01')
  ON CONFLICT DO NOTHING;

  DELETE FROM rentals WHERE organization_id = v_org;
  DELETE FROM rental_series WHERE organization_id = v_org;
  DELETE FROM renter_wallet_ledger WHERE organization_id = v_org AND renter_id = v_renter;
  INSERT INTO renter_wallet_ledger (organization_id, renter_id, entry_type, amount)
  VALUES (v_org, v_renter, 'topup', 400);

  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');

  SELECT pack_from, pack_to, slot_ts, slot_te
  INTO v_pack_from, v_pack_to, v_slot_ts, v_slot_te
  FROM _fdb4_find_pack_monday(v_org);

  v_result := renter_create_recurring_pack(jsonb_build_object(
    'renter_id', v_renter,
    'location_id', v_loc,
    'valid_from', v_pack_from,
    'valid_to', v_pack_to,
    'weekdays', jsonb_build_array(1, 3, 5),
    'time_start', v_slot_ts,
    'time_end', v_slot_te,
    'idempotency_key', 'fdb4-cancel-race'
  ));
  IF NOT (v_result ->> 'success')::boolean THEN
    RAISE EXCEPTION 'cancel-race fixture pack create failed: %', v_result;
  END IF;

  SELECT COALESCE(sum(r.prepay_amount), 0)
  INTO v_total_prepay
  FROM rentals r
  JOIN rental_series rs ON rs.id = r.rental_series_id
  WHERE rs.organization_id = v_org AND rs.idempotency_key = 'fdb4-cancel-race';
END;
$$;

BEGIN;

DO $$
DECLARE
  v_version_id uuid;
  v_org uuid := 'fdb40000-0000-4000-8000-000000000004';
  v_user uuid := 'fdb40000-0000-4000-8000-000000000011';
  v_member uuid := 'fdb40000-0000-4000-8000-000000000024';
  v_loc uuid := 'fdb40000-0000-4000-8000-0000000000cc';
  v_blocker uuid := 'fdb40000-0000-4000-8000-000000000071';
  v_poor uuid := 'fdb40000-0000-4000-8000-000000000072';
  v_win_from date;
  v_win_to date;
  v_pack_from date;
  v_pack_to date;
  v_tail_date date;
  v_slot_ts text;
  v_slot_te text;
  v_check jsonb;
  v_result jsonb;
  v_series uuid;
  v_total_prepay numeric;
  v_awaiting integer;
  v_active integer;
  v_cancelled integer;
  v_auto_deleted integer;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES (
    v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'fdb4-tail@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(),
    '{}'::jsonb, '{}'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'FDB4 Tail Conflict Org', 'fdb4-tail-conflict', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed';

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO NOTHING;

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'FDB4 Tail Owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, currency_code, locale)
  VALUES (v_org, 'Europe/Moscow', 'RUB', 'ru')
  ON CONFLICT (organization_id) DO NOTHING;

  INSERT INTO locations (id, organization_id, name, miniapp_enabled)
  VALUES (v_loc, v_org, 'FDB4 Tail Hall', true)
  ON CONFLICT (id) DO UPDATE SET miniapp_enabled = true;

  INSERT INTO renters (id, organization_id, display_name, status, telegram_id)
  VALUES
    (v_blocker, v_org, 'FDB4 Blocker', 'active', 98071),
    (v_poor, v_org, 'FDB4 Poor', 'active', 98072)
  ON CONFLICT (id) DO UPDATE SET status = 'active';

  INSERT INTO organization_addons (organization_id, addon_code, status, period_start, period_end)
  VALUES (v_org, 'renter_miniapp', 'active', CURRENT_DATE - 1, CURRENT_DATE + 365)
  ON CONFLICT (organization_id, addon_code) DO UPDATE SET status = 'active';

  INSERT INTO location_rental_hour_rates (organization_id, location_id, kind, price, currency, valid_from)
  VALUES
    (v_org, v_loc, 'one_time', 1000, 'RUB', DATE '2000-01-01'),
    (v_org, v_loc, 'recurring', 1000, 'RUB', DATE '2000-01-01'),
    (v_org, v_loc, 'penalty', 1500, 'RUB', DATE '2000-01-01')
  ON CONFLICT DO NOTHING;

  DELETE FROM rentals WHERE organization_id = v_org;
  DELETE FROM rental_series WHERE organization_id = v_org;
  DELETE FROM renter_wallet_ledger WHERE organization_id = v_org;
  INSERT INTO renter_wallet_ledger (organization_id, renter_id, entry_type, amount)
  VALUES
    (v_org, v_blocker, 'topup', 50000),
    (v_org, v_poor, 'topup', 400);

  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');

  SELECT window_start, window_end INTO v_win_from, v_win_to FROM _renter_occupancy_window(v_org);
  SELECT pack_from, pack_to, slot_ts, slot_te
  INTO v_pack_from, v_pack_to, v_slot_ts, v_slot_te
  FROM _fdb4_find_pack_monday(v_org);

  PERFORM _test_assert(v_pack_from <= v_win_to, 'pack Monday inside occupancy window');

  SELECT max(gs::date)
  INTO v_tail_date
  FROM generate_series(v_pack_from, v_pack_to, interval '1 day') gs
  WHERE EXTRACT(ISODOW FROM gs)::int = ANY (ARRAY[1, 3, 5]);

  PERFORM _test_assert(v_tail_date > v_win_to, 'tail occurrence beyond UI occupancy window');

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, hold_expires_at,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, currency
  )
  VALUES (
    'fdb40000-0000-4000-8000-000000000081', v_org, v_blocker, v_loc, v_tail_date, v_slot_ts, v_slot_te,
    'confirmed', 'miniapp', 'active', now() + interval '5 hours',
    500, 500, 0, 1000, 'RUB'
  );

  PERFORM _test_assert(
    _renter_location_slot_busy(v_org, v_tail_date, v_slot_ts, v_slot_te, v_loc),
    'tail blocker occupies grid beyond UI window'
  );

  v_check := _renter_validate_pack_booking(
    v_org, v_poor, v_loc, v_pack_from, v_pack_to, ARRAY[1, 3, 5], v_slot_ts, v_slot_te, true
  );
  PERFORM _test_assert((v_check ->> 'occurrence_count')::int = 12, 'pack validator sees 12 occurrences');
  PERFORM _test_assert((v_check ->> 'busy_count')::int >= 1, 'tail conflict detected in quote validator');
  PERFORM _test_assert((v_check ->> 'can_create')::boolean = false, 'pack cannot be created with tail conflict');

  v_result := renter_create_recurring_pack(jsonb_build_object(
    'renter_id', v_poor,
    'location_id', v_loc,
    'valid_from', v_pack_from,
    'valid_to', v_pack_to,
    'weekdays', jsonb_build_array(1, 3, 5),
    'time_start', v_slot_ts,
    'time_end', v_slot_te,
    'idempotency_key', 'fdb4-tail-pack'
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean = false, 'pack create rejected on tail conflict');
  PERFORM _test_assert(v_result ->> 'error' = 'renter.booking.conflict', 'tail conflict error code');

  -- Sequential overlap: first pack on hold occupies grid
  DELETE FROM renter_reliability_events WHERE renter_id IN (v_blocker, v_poor);
  DELETE FROM renter_telegram_outbox WHERE organization_id = v_org;
  DELETE FROM rentals WHERE organization_id = v_org;
  DELETE FROM rental_series WHERE organization_id = v_org;

  v_result := renter_create_recurring_pack(jsonb_build_object(
    'renter_id', v_poor,
    'location_id', v_loc,
    'valid_from', v_pack_from,
    'valid_to', v_pack_to,
    'weekdays', jsonb_build_array(1, 3, 5),
    'time_start', v_slot_ts,
    'time_end', v_slot_te,
    'idempotency_key', 'fdb4-overlap-a'
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'first pack on hold');
  v_series := (v_result ->> 'series_id')::uuid;
  PERFORM _test_assert(
    (SELECT count(*) FROM rentals WHERE rental_series_id = v_series) = 12,
    'first pack has 12 slots'
  );

  v_result := renter_create_recurring_pack(jsonb_build_object(
    'renter_id', v_blocker,
    'location_id', v_loc,
    'valid_from', v_pack_from,
    'valid_to', v_pack_to,
    'weekdays', jsonb_build_array(1, 3, 5),
    'time_start', v_slot_ts,
    'time_end', v_slot_te,
    'idempotency_key', 'fdb4-overlap-b'
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean = false, 'overlapping second pack rejected');
  PERFORM _test_assert(v_result ->> 'error' = 'renter.booking.conflict', 'overlap conflict error');

  -- Expiry vs topup ordering: topup before expiry activates whole series
  DELETE FROM renter_reliability_events WHERE renter_id IN (v_blocker, v_poor);
  DELETE FROM renter_telegram_outbox WHERE organization_id = v_org;
  DELETE FROM rentals WHERE organization_id = v_org;
  DELETE FROM rental_series WHERE organization_id = v_org;
  DELETE FROM renter_wallet_ledger WHERE organization_id = v_org AND renter_id = v_poor;
  INSERT INTO renter_wallet_ledger (organization_id, renter_id, entry_type, amount)
  VALUES (v_org, v_poor, 'topup', 400);

  v_result := renter_create_recurring_pack(jsonb_build_object(
    'renter_id', v_poor,
    'location_id', v_loc,
    'valid_from', v_pack_from,
    'valid_to', v_pack_to,
    'weekdays', jsonb_build_array(1, 3, 5),
    'time_start', to_char((v_slot_ts::time + interval '2 hours'), 'HH24:MI'),
    'time_end', to_char((v_slot_te::time + interval '2 hours'), 'HH24:MI'),
    'idempotency_key', 'fdb4-topup-win'
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'topup-win pack create');
  v_series := (v_result ->> 'series_id')::uuid;

  SELECT COALESCE(sum(r.prepay_amount), 0) INTO v_total_prepay
  FROM rentals r WHERE r.rental_series_id = v_series;

  v_result := staff_renter_wallet_topup(jsonb_build_object(
    'renter_id', v_poor,
    'amount', v_total_prepay,
    'method', 'cash',
    'idempotency_key', gen_random_uuid()
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'full topup before expiry');

  SELECT count(*) INTO v_awaiting
  FROM rentals r WHERE r.rental_series_id = v_series AND r.lifecycle = 'awaiting_payment';
  PERFORM _test_assert(v_awaiting = 0, 'no awaiting after topup-win');

  SELECT count(*) INTO v_active
  FROM rentals r
  WHERE r.rental_series_id = v_series
    AND r.lifecycle IN ('active', 'prepaid_charged');
  PERFORM _test_assert(v_active = 12, 'all 12 active after topup-win');
  PERFORM _test_assert(
    (SELECT status FROM rental_series WHERE id = v_series) = 'active',
    'series active after topup-win'
  );

  -- Expiry wins when topup is too late
  DELETE FROM renter_reliability_events WHERE renter_id IN (v_blocker, v_poor);
  DELETE FROM renter_telegram_outbox WHERE organization_id = v_org;
  DELETE FROM rentals WHERE organization_id = v_org;
  DELETE FROM rental_series WHERE organization_id = v_org;
  DELETE FROM renter_wallet_ledger WHERE organization_id = v_org AND renter_id = v_poor;
  INSERT INTO renter_wallet_ledger (organization_id, renter_id, entry_type, amount)
  VALUES (v_org, v_poor, 'topup', 400);

  v_result := renter_create_recurring_pack(jsonb_build_object(
    'renter_id', v_poor,
    'location_id', v_loc,
    'valid_from', v_pack_from,
    'valid_to', v_pack_to,
    'weekdays', jsonb_build_array(1, 3, 5),
    'time_start', to_char((v_slot_ts::time + interval '4 hours'), 'HH24:MI'),
    'time_end', to_char((v_slot_te::time + interval '4 hours'), 'HH24:MI'),
    'idempotency_key', 'fdb4-expire-win'
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'expire-win pack create');
  v_series := (v_result ->> 'series_id')::uuid;

  UPDATE rental_series SET hold_expires_at = now() - interval '1 minute' WHERE id = v_series;
  UPDATE rentals SET hold_expires_at = now() - interval '1 minute' WHERE rental_series_id = v_series;
  PERFORM _renter_expire_and_catchup(v_org, v_poor);

  SELECT count(*) INTO v_auto_deleted
  FROM rentals r WHERE r.rental_series_id = v_series AND r.lifecycle = 'auto_deleted';
  PERFORM _test_assert(v_auto_deleted = 12, 'expire-win deletes all 12 slots');
  PERFORM _test_assert(
    (SELECT status FROM rental_series WHERE id = v_series) = 'cancelled',
    'series cancelled on expire-win'
  );

  SELECT COALESCE(sum(r.prepay_amount), 0) INTO v_total_prepay
  FROM rentals r WHERE r.rental_series_id = v_series;

  v_result := staff_renter_wallet_topup(jsonb_build_object(
    'renter_id', v_poor,
    'amount', v_total_prepay,
    'method', 'cash',
    'idempotency_key', gen_random_uuid()
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'late topup still credits wallet');

  SELECT count(*) INTO v_active
  FROM rentals r
  WHERE r.rental_series_id = v_series
    AND r.lifecycle IN ('active', 'prepaid_charged', 'awaiting_payment');
  PERFORM _test_assert(v_active = 0, 'late topup does not partially activate expired series');

  -- Cancel vs activate: cancel on hold releases all dates atomically
  DELETE FROM renter_reliability_events WHERE renter_id IN (v_blocker, v_poor);
  DELETE FROM renter_telegram_outbox WHERE organization_id = v_org;
  DELETE FROM rentals WHERE organization_id = v_org;
  DELETE FROM rental_series WHERE organization_id = v_org;
  DELETE FROM renter_wallet_ledger WHERE organization_id = v_org AND renter_id = v_poor;
  INSERT INTO renter_wallet_ledger (organization_id, renter_id, entry_type, amount)
  VALUES (v_org, v_poor, 'topup', 400);

  v_result := renter_create_recurring_pack(jsonb_build_object(
    'renter_id', v_poor,
    'location_id', v_loc,
    'valid_from', v_pack_from,
    'valid_to', v_pack_to,
    'weekdays', jsonb_build_array(1, 3, 5),
    'time_start', to_char((v_slot_ts::time + interval '6 hours'), 'HH24:MI'),
    'time_end', to_char((v_slot_te::time + interval '6 hours'), 'HH24:MI'),
    'idempotency_key', 'fdb4-cancel-win'
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'cancel-win pack create');
  v_series := (v_result ->> 'series_id')::uuid;

  v_result := renter_cancel_pack(v_series);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'cancel pack on hold');
  PERFORM _test_assert(jsonb_array_length(v_result -> 'cancelled') = 12, 'cancel releases 12 dates');

  SELECT count(*) INTO v_cancelled
  FROM rentals r WHERE r.rental_series_id = v_series AND r.lifecycle = 'hold_deleted';
  PERFORM _test_assert(v_cancelled = 12, 'all 12 hold_deleted after cancel');

  SELECT COALESCE(sum(r.prepay_amount), 0) INTO v_total_prepay
  FROM rentals r WHERE r.rental_series_id = v_series;

  v_result := staff_renter_wallet_topup(jsonb_build_object(
    'renter_id', v_poor,
    'amount', v_total_prepay,
    'method', 'cash',
    'idempotency_key', gen_random_uuid()
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'topup after cancel');

  SELECT count(*) INTO v_active
  FROM rentals r
  WHERE r.rental_series_id = v_series
    AND r.lifecycle IN ('active', 'prepaid_charged', 'awaiting_payment');
  PERFORM _test_assert(v_active = 0, 'topup after cancel does not resurrect series');

  RAISE NOTICE 'FDB4 in-transaction series tests passed';
END;
$$;

ROLLBACK;
