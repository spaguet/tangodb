-- FA5 / P1-17: pack idempotency key compares canonical payload fingerprint.
-- Run: npm run test:db:renter-miniapp-fa5

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

CREATE OR REPLACE FUNCTION _fa5_pack_slot(p_org uuid, p_ahead interval)
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
  v_org uuid := 'fa500000-0000-4000-8000-000000000001';
  v_user uuid := 'fa500000-0000-4000-8000-000000000011';
  v_member uuid := 'fa500000-0000-4000-8000-000000000021';
  v_loc uuid := 'fa500000-0000-4000-8000-0000000000aa';
  v_renter uuid := 'fa500000-0000-4000-8000-000000000041';
  v_win_from date;
  v_win_to date;
  v_pack_from date;
  v_pack_to date;
  v_slot_ts text;
  v_slot_te text;
  v_result jsonb;
  v_series uuid;
  v_series_n int;
  v_fp text;
  v_stored_fp text;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES (
    v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'fa5-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(),
    '{}'::jsonb, '{}'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'FA5 Pack FP Org', 'fa5-pack-fp', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed', owner_user_id = EXCLUDED.owner_user_id;

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET license_type = 'lifetime', activated_at = now();

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'FA5 Owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, currency_code, locale)
  VALUES (v_org, 'Europe/Moscow', 'RUB', 'ru')
  ON CONFLICT (organization_id) DO UPDATE SET
    timezone = EXCLUDED.timezone,
    currency_code = EXCLUDED.currency_code;

  INSERT INTO locations (id, organization_id, name, miniapp_enabled)
  VALUES (v_loc, v_org, 'FA5 Hall', true)
  ON CONFLICT (id) DO UPDATE SET miniapp_enabled = true;

  INSERT INTO renters (id, organization_id, display_name, status, telegram_id)
  VALUES (v_renter, v_org, 'FA5 Pack Renter', 'active', 95001)
  ON CONFLICT (id) DO UPDATE SET status = 'active', telegram_id = EXCLUDED.telegram_id;

  INSERT INTO organization_addons (organization_id, addon_code, status, period_start, period_end)
  VALUES (v_org, 'renter_miniapp', 'active', CURRENT_DATE - 1, CURRENT_DATE + 365)
  ON CONFLICT (organization_id, addon_code) DO UPDATE SET
    status = 'active', period_start = EXCLUDED.period_start, period_end = EXCLUDED.period_end;

  INSERT INTO location_rental_hour_rates (organization_id, location_id, kind, price, currency, valid_from)
  VALUES
    (v_org, v_loc, 'one_time', 1000, 'RUB', DATE '2000-01-01'),
    (v_org, v_loc, 'recurring', 1000, 'RUB', DATE '2000-01-01'),
    (v_org, v_loc, 'penalty', 1500, 'RUB', DATE '2000-01-01')
  ON CONFLICT DO NOTHING;

  INSERT INTO renter_wallet_ledger (organization_id, renter_id, entry_type, amount)
  VALUES (v_org, v_renter, 'topup', 50000)
  ON CONFLICT DO NOTHING;

  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');

  SELECT window_start, window_end
  INTO v_win_from, v_win_to
  FROM _renter_occupancy_window(v_org);

  SELECT d, ts, te INTO v_pack_from, v_slot_ts, v_slot_te
  FROM _fa5_pack_slot(v_org, interval '72 hours');

  WHILE EXTRACT(ISODOW FROM v_pack_from)::int NOT IN (1, 3, 5)
     OR v_pack_from < v_win_from
     OR v_pack_from > v_win_to
  LOOP
    v_pack_from := v_pack_from + 1;
    EXIT WHEN v_pack_from > v_win_to;
  END LOOP;
  WHILE EXTRACT(ISODOW FROM v_pack_from)::int <> 1 AND v_pack_from <= v_win_to LOOP
    v_pack_from := v_pack_from + 1;
  END LOOP;
  PERFORM _test_assert(v_pack_from <= v_win_to, 'pack Monday inside occupancy window');
  v_pack_to := v_pack_from + 27;

  v_fp := _renter_pack_payload_fingerprint(
    v_loc, v_pack_from, v_pack_to, ARRAY[1, 3, 5], v_slot_ts, v_slot_te, v_renter
  );

  -- First create succeeds and stores fingerprint
  v_result := renter_create_recurring_pack(jsonb_build_object(
    'renter_id', v_renter,
    'location_id', v_loc,
    'valid_from', v_pack_from,
    'valid_to', v_pack_to,
    'weekdays', jsonb_build_array(1, 3, 5),
    'time_start', v_slot_ts,
    'time_end', v_slot_te,
    'idempotency_key', 'fa5-pack-fp-ok'
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'pack create: ' || COALESCE(v_result ->> 'error', 'ok'));
  v_series := (v_result ->> 'series_id')::uuid;

  SELECT payload_fingerprint INTO v_stored_fp
  FROM rental_series WHERE id = v_series;
  PERFORM _test_assert(v_stored_fp = v_fp, 'series stores canonical payload fingerprint');

  -- Same key + same payload → one series (idempotent retry)
  v_result := renter_create_recurring_pack(jsonb_build_object(
    'renter_id', v_renter,
    'location_id', v_loc,
    'valid_from', v_pack_from,
    'valid_to', v_pack_to,
    'weekdays', jsonb_build_array(1, 3, 5),
    'time_start', v_slot_ts,
    'time_end', v_slot_te,
    'idempotency_key', 'fa5-pack-fp-ok'
  ));
  PERFORM _test_assert((v_result ->> 'already_applied')::boolean, 'same key+payload returns existing series');
  PERFORM _test_assert((v_result ->> 'series_id')::uuid = v_series, 'idempotent retry returns same series_id');

  SELECT count(*) INTO v_series_n
  FROM rental_series
  WHERE organization_id = v_org AND idempotency_key = 'fa5-pack-fp-ok';
  PERFORM _test_assert(v_series_n = 1, 'only one series row for idempotency key');

  -- Same key + different weekdays (still includes valid_from Monday) → conflict
  v_result := renter_create_recurring_pack(jsonb_build_object(
    'renter_id', v_renter,
    'location_id', v_loc,
    'valid_from', v_pack_from,
    'valid_to', v_pack_to,
    'weekdays', jsonb_build_array(1, 2, 4),
    'time_start', v_slot_ts,
    'time_end', v_slot_te,
    'idempotency_key', 'fa5-pack-fp-ok'
  ));
  PERFORM _test_assert(
    (v_result ->> 'success') IS DISTINCT FROM 'true'
      AND v_result ->> 'error' = 'renter.booking.idempotencyMismatch',
    'same key different weekdays refused: ' || COALESCE(v_result ->> 'error', v_result::text)
  );

  -- Same key + different time → conflict
  v_result := renter_create_recurring_pack(jsonb_build_object(
    'renter_id', v_renter,
    'location_id', v_loc,
    'valid_from', v_pack_from,
    'valid_to', v_pack_to,
    'weekdays', jsonb_build_array(1, 3, 5),
    'time_start', '20:00',
    'time_end', '21:00',
    'idempotency_key', 'fa5-pack-fp-ok'
  ));
  PERFORM _test_assert(
    v_result ->> 'error' = 'renter.booking.idempotencyMismatch',
    'same key different time refused'
  );

  -- Legacy fingerprint helper matches stored column
  PERFORM _test_assert(
    _renter_pack_series_fingerprint(v_series) = v_fp,
    'series fingerprint helper matches stored hash'
  );

  RAISE NOTICE 'renter_miniapp_fa5_pack_fingerprint_test: OK';
END;
$$;

ROLLBACK;
