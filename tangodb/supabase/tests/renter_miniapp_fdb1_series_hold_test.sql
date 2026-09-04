-- FDB1 / variant B: series-level hold when pack balance insufficient.
-- Run: npm run test:db:renter-miniapp-fdb1

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

CREATE OR REPLACE FUNCTION _fdb1_pack_slot(p_org uuid, p_ahead interval)
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
  v_org uuid := 'fdb10000-0000-4000-8000-000000000001';
  v_user uuid := 'fdb10000-0000-4000-8000-000000000011';
  v_member uuid := 'fdb10000-0000-4000-8000-000000000021';
  v_loc uuid := 'fdb10000-0000-4000-8000-0000000000aa';
  v_renter_poor uuid := 'fdb10000-0000-4000-8000-000000000041';
  v_renter_rich uuid := 'fdb10000-0000-4000-8000-000000000042';
  v_win_from date;
  v_win_to date;
  v_pack_from date;
  v_pack_to date;
  v_slot_ts text;
  v_slot_te text;
  v_result jsonb;
  v_series uuid;
  v_hold timestamptz;
  v_expected_hold timestamptz;
  v_untimely_before integer;
  v_untimely_after integer;
  v_reliability_n integer;
  v_series_status text;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES (
    v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'fdb1-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(),
    '{}'::jsonb, '{}'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'FDB1 Series Hold Org', 'fdb1-series-hold', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed', owner_user_id = EXCLUDED.owner_user_id;

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET license_type = 'lifetime', activated_at = now();

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'FDB1 Owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, currency_code, locale)
  VALUES (v_org, 'Europe/Moscow', 'RUB', 'ru')
  ON CONFLICT (organization_id) DO UPDATE SET
    timezone = EXCLUDED.timezone,
    currency_code = EXCLUDED.currency_code;

  INSERT INTO locations (id, organization_id, name, miniapp_enabled)
  VALUES (v_loc, v_org, 'FDB1 Hall', true)
  ON CONFLICT (id) DO UPDATE SET miniapp_enabled = true;

  INSERT INTO renters (id, organization_id, display_name, status, telegram_id)
  VALUES
    (v_renter_poor, v_org, 'FDB1 Poor', 'active', 96001),
    (v_renter_rich, v_org, 'FDB1 Rich', 'active', 96002)
  ON CONFLICT (id) DO UPDATE SET status = 'active';

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

  DELETE FROM renter_wallet_ledger WHERE organization_id = v_org AND renter_id IN (v_renter_poor, v_renter_rich);
  INSERT INTO renter_wallet_ledger (organization_id, renter_id, entry_type, amount)
  VALUES
    (v_org, v_renter_poor, 'topup', 400),
    (v_org, v_renter_rich, 'topup', 50000);

  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');

  SELECT window_start, window_end
  INTO v_win_from, v_win_to
  FROM _renter_occupancy_window(v_org);

  SELECT d, ts, te INTO v_pack_from, v_slot_ts, v_slot_te
  FROM _fdb1_pack_slot(v_org, interval '72 hours');

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

  v_result := renter_create_recurring_pack(jsonb_build_object(
    'renter_id', v_renter_poor,
    'location_id', v_loc,
    'valid_from', v_pack_from,
    'valid_to', v_pack_to,
    'weekdays', jsonb_build_array(1, 3, 5),
    'time_start', v_slot_ts,
    'time_end', v_slot_te,
    'idempotency_key', 'fdb1-pack-hold'
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'poor pack create: ' || COALESCE(v_result ->> 'error', 'ok'));
  PERFORM _test_assert(
    v_result ->> 'series_status' = 'awaiting_payment',
    'response series_status awaiting_payment'
  );
  PERFORM _test_assert(v_result ->> 'hold_expires_at' IS NOT NULL, 'response hold_expires_at set');

  v_series := (v_result ->> 'series_id')::uuid;
  SELECT hold_expires_at, status INTO v_hold, v_series_status
  FROM rental_series WHERE id = v_series;
  PERFORM _test_assert(v_series_status = 'awaiting_payment', 'series.status awaiting_payment');
  PERFORM _test_assert(v_hold IS NOT NULL, 'series.hold_expires_at set');

  PERFORM _test_assert(
    (SELECT count(*) FROM rentals r WHERE r.rental_series_id = v_series) = 12,
    '12 occurrences persisted'
  );
  PERFORM _test_assert(
    (SELECT count(*) FROM rentals r WHERE r.rental_series_id = v_series AND r.lifecycle = 'awaiting_payment') = 12,
    'all 12 slots awaiting_payment'
  );
  PERFORM _test_assert(
    NOT EXISTS (
      SELECT 1 FROM rentals r
      WHERE r.rental_series_id = v_series
        AND r.hold_expires_at IS DISTINCT FROM v_hold
    ),
    'occurrence hold_expires_at synced to series'
  );

  SELECT _renter_compute_series_hold_expires_at(v_org, v_series) INTO v_expected_hold;
  PERFORM _test_assert(v_hold = v_expected_hold, 'hold = min(created+24h, earliest start)');

  PERFORM _test_assert(
    _renter_location_slot_busy(v_org, v_pack_from, v_slot_ts, v_slot_te, v_loc),
    'first pack date occupies grid while on hold'
  );

  v_result := renter_create_recurring_pack(jsonb_build_object(
    'renter_id', v_renter_rich,
    'location_id', v_loc,
    'valid_from', v_pack_from,
    'valid_to', v_pack_to,
    'weekdays', jsonb_build_array(1, 3, 5),
    'time_start', to_char((v_slot_ts::time + interval '2 hours'), 'HH24:MI'),
    'time_end', to_char((v_slot_te::time + interval '2 hours'), 'HH24:MI'),
    'idempotency_key', 'fdb1-pack-active'
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'rich pack create: ' || COALESCE(v_result ->> 'error', 'ok'));
  PERFORM _test_assert(v_result ->> 'series_status' = 'active', 'rich pack series active');
  v_series := (v_result ->> 'series_id')::uuid;
  PERFORM _test_assert(
    NOT EXISTS (
      SELECT 1 FROM rentals r
      WHERE r.rental_series_id = v_series AND r.lifecycle = 'awaiting_payment'
    ),
    'rich pack: no awaiting slots'
  );

  SELECT untimely_count INTO v_untimely_before
  FROM renters WHERE id = v_renter_poor;

  UPDATE rental_series
  SET hold_expires_at = now() - interval '1 minute'
  WHERE id = (SELECT id FROM rental_series WHERE organization_id = v_org AND idempotency_key = 'fdb1-pack-hold');

  UPDATE rentals
  SET hold_expires_at = now() - interval '1 minute'
  WHERE rental_series_id = (SELECT id FROM rental_series WHERE organization_id = v_org AND idempotency_key = 'fdb1-pack-hold');

  PERFORM _renter_expire_and_catchup(v_org, v_renter_poor);

  SELECT untimely_count INTO v_untimely_after
  FROM renters WHERE id = v_renter_poor;

  PERFORM _test_assert(
    v_untimely_after = v_untimely_before + 1,
    'series expiry adds exactly one untimely (was ' || v_untimely_before || ', now ' || v_untimely_after || ')'
  );

  SELECT count(*) INTO v_reliability_n
  FROM renter_reliability_events e
  JOIN rentals r ON r.id = e.rental_id
  JOIN rental_series rs ON rs.id = r.rental_series_id
  WHERE rs.organization_id = v_org
    AND rs.idempotency_key = 'fdb1-pack-hold'
    AND e.phase = 'untimely';

  PERFORM _test_assert(v_reliability_n = 1, 'one reliability event for expired series');

  PERFORM _test_assert(
    (SELECT status FROM rental_series WHERE organization_id = v_org AND idempotency_key = 'fdb1-pack-hold') = 'cancelled',
    'expired series cancelled'
  );
  PERFORM _test_assert(
    (SELECT count(*) FROM rentals r
     JOIN rental_series rs ON rs.id = r.rental_series_id
     WHERE rs.idempotency_key = 'fdb1-pack-hold' AND r.lifecycle = 'auto_deleted') = 12,
    'all 12 slots auto_deleted on series expiry'
  );

  RAISE NOTICE 'FDB1 series hold tests passed';
END;
$$;

ROLLBACK;
