-- FDB2: atomic series activation on topup; cancel pack on hold; no partial dates.
-- Run: npm run test:db:renter-miniapp-fdb2

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

CREATE OR REPLACE FUNCTION _fdb2_pack_slot(p_org uuid, p_ahead interval)
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
  v_org uuid := 'fdb20000-0000-4000-8000-000000000001';
  v_user uuid := 'fdb20000-0000-4000-8000-000000000011';
  v_member uuid := 'fdb20000-0000-4000-8000-000000000021';
  v_loc uuid := 'fdb20000-0000-4000-8000-0000000000aa';
  v_renter uuid := 'fdb20000-0000-4000-8000-000000000041';
  v_win_from date;
  v_win_to date;
  v_pack_from date;
  v_pack_to date;
  v_slot_ts text;
  v_slot_te text;
  v_result jsonb;
  v_series uuid;
  v_series_cancel uuid;
  v_total_prepay numeric;
  v_awaiting integer;
  v_active integer;
  v_prepaid integer;
  v_series_status text;
  v_hold_cleared timestamptz;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES (
    v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'fdb2-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(),
    '{}'::jsonb, '{}'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'FDB2 Series Activation Org', 'fdb2-series-activation', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed', owner_user_id = EXCLUDED.owner_user_id;

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET license_type = 'lifetime', activated_at = now();

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'FDB2 Owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, currency_code, locale)
  VALUES (v_org, 'Europe/Moscow', 'RUB', 'ru')
  ON CONFLICT (organization_id) DO UPDATE SET
    timezone = EXCLUDED.timezone,
    currency_code = EXCLUDED.currency_code;

  INSERT INTO locations (id, organization_id, name, miniapp_enabled)
  VALUES (v_loc, v_org, 'FDB2 Hall', true)
  ON CONFLICT (id) DO UPDATE SET miniapp_enabled = true;

  INSERT INTO renters (id, organization_id, display_name, status, telegram_id)
  VALUES (v_renter, v_org, 'FDB2 Renter', 'active', 96101)
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

  DELETE FROM renter_wallet_ledger WHERE organization_id = v_org AND renter_id = v_renter;
  INSERT INTO renter_wallet_ledger (organization_id, renter_id, entry_type, amount)
  VALUES (v_org, v_renter, 'topup', 400);

  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');

  SELECT window_start, window_end
  INTO v_win_from, v_win_to
  FROM _renter_occupancy_window(v_org);

  SELECT d, ts, te INTO v_pack_from, v_slot_ts, v_slot_te
  FROM _fdb2_pack_slot(v_org, interval '72 hours');

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
    'renter_id', v_renter,
    'location_id', v_loc,
    'valid_from', v_pack_from,
    'valid_to', v_pack_to,
    'weekdays', jsonb_build_array(1, 3, 5),
    'time_start', v_slot_ts,
    'time_end', v_slot_te,
    'idempotency_key', 'fdb2-pack-activate'
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'pack create on hold: ' || COALESCE(v_result ->> 'error', 'ok'));
  v_series := (v_result ->> 'series_id')::uuid;

  SELECT COALESCE(sum(r.prepay_amount), 0)
  INTO v_total_prepay
  FROM rentals r
  WHERE r.rental_series_id = v_series;

  PERFORM _test_assert(v_total_prepay > 400, 'series prepay exceeds starting balance');

  SELECT count(*) INTO v_awaiting
  FROM rentals r
  WHERE r.rental_series_id = v_series AND r.lifecycle = 'awaiting_payment';
  PERFORM _test_assert(v_awaiting = 12, 'all 12 slots awaiting before topup');

  -- Partial topup: must NOT partially activate any dates
  v_result := staff_renter_wallet_topup(jsonb_build_object(
    'renter_id', v_renter,
    'amount', 2000,
    'method', 'cash',
    'idempotency_key', gen_random_uuid()
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'partial topup ok');

  SELECT count(*) INTO v_awaiting
  FROM rentals r
  WHERE r.rental_series_id = v_series AND r.lifecycle = 'awaiting_payment';
  PERFORM _test_assert(v_awaiting = 12, 'partial topup leaves all 12 awaiting');

  SELECT status INTO v_series_status FROM rental_series WHERE id = v_series;
  PERFORM _test_assert(v_series_status = 'awaiting_payment', 'series still on hold after partial topup');

  -- Full topup: atomic activation of entire series
  v_result := staff_renter_wallet_topup(jsonb_build_object(
    'renter_id', v_renter,
    'amount', v_total_prepay,
    'method', 'cash',
    'idempotency_key', gen_random_uuid()
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'full topup ok');

  SELECT count(*) INTO v_awaiting
  FROM rentals r
  WHERE r.rental_series_id = v_series AND r.lifecycle = 'awaiting_payment';
  PERFORM _test_assert(v_awaiting = 0, 'no awaiting slots after full topup');

  SELECT
    count(*) FILTER (WHERE r.lifecycle = 'active'),
    count(*) FILTER (WHERE r.lifecycle = 'prepaid_charged')
  INTO v_active, v_prepaid
  FROM rentals r
  WHERE r.rental_series_id = v_series;

  PERFORM _test_assert(
    v_active + v_prepaid = 12,
    'all 12 slots active or prepaid_charged (active=' || v_active || ', prepaid=' || v_prepaid || ')'
  );

  SELECT status, hold_expires_at INTO v_series_status, v_hold_cleared
  FROM rental_series WHERE id = v_series;
  PERFORM _test_assert(v_series_status = 'active', 'series active after full topup');
  PERFORM _test_assert(v_hold_cleared IS NULL, 'series hold_expires_at cleared');

  -- Cancel pack on hold — separate series, all dates in one batch
  v_result := renter_create_recurring_pack(jsonb_build_object(
    'renter_id', v_renter,
    'location_id', v_loc,
    'valid_from', v_pack_from,
    'valid_to', v_pack_to,
    'weekdays', jsonb_build_array(1, 3, 5),
    'time_start', to_char((v_slot_ts::time + interval '2 hours'), 'HH24:MI'),
    'time_end', to_char((v_slot_te::time + interval '2 hours'), 'HH24:MI'),
    'idempotency_key', 'fdb2-pack-cancel'
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'cancel-target pack create: ' || COALESCE(v_result ->> 'error', 'ok'));
  v_series_cancel := (v_result ->> 'series_id')::uuid;
  PERFORM _test_assert(
    (SELECT status FROM rental_series WHERE id = v_series_cancel) = 'awaiting_payment',
    'cancel-target series on hold'
  );

  v_result := renter_cancel_pack(v_series_cancel);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'cancel pack on hold: ' || COALESCE(v_result ->> 'error', 'ok'));
  PERFORM _test_assert(
    jsonb_array_length(v_result -> 'cancelled') = 12,
    'cancel pack releases all 12 dates in one operation'
  );
  PERFORM _test_assert(
    (SELECT status FROM rental_series WHERE id = v_series_cancel) = 'cancelled',
    'series cancelled after pack cancel on hold'
  );
  PERFORM _test_assert(
    (SELECT count(*) FROM rentals r
     WHERE r.rental_series_id = v_series_cancel AND r.lifecycle = 'hold_deleted') = 12,
    'all 12 slots hold_deleted'
  );

  -- Series expiry still atomic (clean prior series so wallet reset is valid)
  DELETE FROM rentals WHERE organization_id = v_org AND renter_id = v_renter;
  DELETE FROM rental_series WHERE organization_id = v_org AND renter_id = v_renter;
  DELETE FROM renter_wallet_ledger WHERE organization_id = v_org AND renter_id = v_renter;
  INSERT INTO renter_wallet_ledger (organization_id, renter_id, entry_type, amount)
  VALUES (v_org, v_renter, 'topup', 400);

  v_result := renter_create_recurring_pack(jsonb_build_object(
    'renter_id', v_renter,
    'location_id', v_loc,
    'valid_from', v_pack_from,
    'valid_to', v_pack_to,
    'weekdays', jsonb_build_array(1, 3, 5),
    'time_start', to_char((v_slot_ts::time + interval '4 hours'), 'HH24:MI'),
    'time_end', to_char((v_slot_te::time + interval '4 hours'), 'HH24:MI'),
    'idempotency_key', 'fdb2-pack-expire'
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'expire-target pack create');

  UPDATE rental_series
  SET hold_expires_at = now() - interval '1 minute'
  WHERE idempotency_key = 'fdb2-pack-expire';

  UPDATE rentals
  SET hold_expires_at = now() - interval '1 minute'
  WHERE rental_series_id = (SELECT id FROM rental_series WHERE idempotency_key = 'fdb2-pack-expire');

  PERFORM _renter_expire_and_catchup(v_org, v_renter);

  PERFORM _test_assert(
    (SELECT status FROM rental_series WHERE idempotency_key = 'fdb2-pack-expire') = 'cancelled',
    'expired series cancelled atomically'
  );
  PERFORM _test_assert(
    (SELECT count(*) FROM rentals r
     JOIN rental_series rs ON rs.id = r.rental_series_id
     WHERE rs.idempotency_key = 'fdb2-pack-expire' AND r.lifecycle = 'auto_deleted') = 12,
    'expiry auto_deletes all 12 slots in one pass'
  );

  RAISE NOTICE 'FDB2 series activation tests passed';
END;
$$;

ROLLBACK;
