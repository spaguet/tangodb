-- FDB3: one reliability + one outbox per pack series; list_mine series metadata.
-- Run: npm run test:db:renter-miniapp-fdb3

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

CREATE OR REPLACE FUNCTION _fdb3_pack_slot(p_org uuid, p_ahead interval)
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

CREATE OR REPLACE FUNCTION _fdb3_set_renter_jwt(p_user uuid, p_org uuid, p_renter uuid, p_telegram bigint)
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
        'renter_id', p_renter::text,
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
  v_org uuid := 'fdb30000-0000-4000-8000-000000000001';
  v_user uuid := 'fdb30000-0000-4000-8000-000000000011';
  v_renter_user uuid := 'fdb30000-0000-4000-8000-000000000012';
  v_member uuid := 'fdb30000-0000-4000-8000-000000000021';
  v_loc uuid := 'fdb30000-0000-4000-8000-0000000000aa';
  v_renter uuid := 'fdb30000-0000-4000-8000-000000000041';
  v_win_from date;
  v_win_to date;
  v_pack_from date;
  v_pack_to date;
  v_slot_ts text;
  v_slot_te text;
  v_result jsonb;
  v_series uuid;
  v_outbox_n integer;
  v_list jsonb;
  v_item jsonb;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES (
    v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'fdb3-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(),
    '{}'::jsonb, '{}'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES (
    v_renter_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'fdb3-renter@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(),
    jsonb_build_object(
      'actor', 'renter',
      'organization_id', v_org::text,
      'renter_id', v_renter::text,
      'telegram_id', '97001'
    ),
    '{}'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'FDB3 Series UX Org', 'fdb3-series-ux', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed', owner_user_id = EXCLUDED.owner_user_id;

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET license_type = 'lifetime', activated_at = now();

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'FDB3 Owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, currency_code, locale)
  VALUES (v_org, 'Europe/Moscow', 'RUB', 'ru')
  ON CONFLICT (organization_id) DO UPDATE SET timezone = EXCLUDED.timezone;

  INSERT INTO locations (id, organization_id, name, miniapp_enabled)
  VALUES (v_loc, v_org, 'FDB3 Hall', true)
  ON CONFLICT (id) DO UPDATE SET miniapp_enabled = true;

  INSERT INTO renters (id, organization_id, display_name, status, telegram_id, auth_user_id)
  VALUES (v_renter, v_org, 'FDB3 Renter', 'active', 97001, v_renter_user)
  ON CONFLICT (id) DO UPDATE SET
    status = 'active',
    telegram_id = 97001,
    auth_user_id = EXCLUDED.auth_user_id;

  INSERT INTO organization_addons (organization_id, addon_code, status, period_start, period_end)
  VALUES (v_org, 'renter_miniapp', 'active', CURRENT_DATE - 1, CURRENT_DATE + 365)
  ON CONFLICT (organization_id, addon_code) DO UPDATE SET status = 'active';

  INSERT INTO location_rental_hour_rates (organization_id, location_id, kind, price, currency, valid_from)
  VALUES
    (v_org, v_loc, 'one_time', 1000, 'RUB', DATE '2000-01-01'),
    (v_org, v_loc, 'recurring', 1000, 'RUB', DATE '2000-01-01'),
    (v_org, v_loc, 'penalty', 1500, 'RUB', DATE '2000-01-01')
  ON CONFLICT DO NOTHING;

  DELETE FROM renter_telegram_outbox WHERE organization_id = v_org;
  DELETE FROM renter_reliability_events WHERE renter_id = v_renter;
  DELETE FROM renter_wallet_ledger WHERE organization_id = v_org AND renter_id = v_renter;
  INSERT INTO renter_wallet_ledger (organization_id, renter_id, entry_type, amount)
  VALUES (v_org, v_renter, 'topup', 400);

  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');

  SELECT window_start, window_end INTO v_win_from, v_win_to FROM _renter_occupancy_window(v_org);
  SELECT d, ts, te INTO v_pack_from, v_slot_ts, v_slot_te FROM _fdb3_pack_slot(v_org, interval '72 hours');
  WHILE EXTRACT(ISODOW FROM v_pack_from)::int NOT IN (1, 3, 5) OR v_pack_from < v_win_from LOOP
    v_pack_from := v_pack_from + 1;
    EXIT WHEN v_pack_from > v_win_to;
  END LOOP;
  WHILE EXTRACT(ISODOW FROM v_pack_from)::int <> 1 AND v_pack_from <= v_win_to LOOP
    v_pack_from := v_pack_from + 1;
  END LOOP;
  v_pack_to := v_pack_from + 27;

  v_result := renter_create_recurring_pack(jsonb_build_object(
    'renter_id', v_renter,
    'location_id', v_loc,
    'valid_from', v_pack_from,
    'valid_to', v_pack_to,
    'weekdays', jsonb_build_array(1, 3, 5),
    'time_start', v_slot_ts,
    'time_end', v_slot_te,
    'idempotency_key', 'fdb3-pack-hold'
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'pack create');
  v_series := (v_result ->> 'series_id')::uuid;

  SELECT count(*) INTO v_outbox_n
  FROM renter_telegram_outbox
  WHERE organization_id = v_org
    AND renter_id = v_renter
    AND event_type = 'hold_awaiting'
    AND dedupe_key = 'series_hold_awaiting:' || v_series::text;
  PERFORM _test_assert(v_outbox_n = 1, 'one series hold_awaiting outbox on create');

  UPDATE rental_series SET hold_expires_at = now() - interval '1 minute' WHERE id = v_series;
  UPDATE rentals SET hold_expires_at = now() - interval '1 minute' WHERE rental_series_id = v_series;

  PERFORM _renter_expire_and_catchup(v_org, v_renter);

  SELECT count(*) INTO v_outbox_n
  FROM renter_telegram_outbox
  WHERE organization_id = v_org
    AND renter_id = v_renter
    AND event_type = 'auto_deleted'
    AND dedupe_key = 'series_auto_deleted:' || v_series::text;
  PERFORM _test_assert(v_outbox_n = 1, 'one series auto_deleted outbox on expiry');

  SELECT count(*) INTO v_outbox_n
  FROM renter_telegram_outbox
  WHERE organization_id = v_org
    AND renter_id = v_renter
    AND event_type = 'auto_deleted'
    AND dedupe_key LIKE 'auto_deleted:%'
    AND dedupe_key NOT LIKE 'series_%';
  PERFORM _test_assert(v_outbox_n = 0, 'no per-slot auto_deleted outbox storm');

  PERFORM _test_assert(
    (SELECT count(*) FROM renter_reliability_events e
     JOIN rentals r ON r.id = e.rental_id
     WHERE r.rental_series_id = v_series AND e.phase = 'untimely') = 1,
    'one untimely reliability event for expired series'
  );

  DELETE FROM renter_telegram_outbox WHERE organization_id = v_org;
  DELETE FROM renter_reliability_events WHERE renter_id = v_renter;
  DELETE FROM rentals WHERE rental_series_id = v_series;
  DELETE FROM rental_series WHERE id = v_series;
  DELETE FROM renter_wallet_ledger WHERE organization_id = v_org AND renter_id = v_renter;
  INSERT INTO renter_wallet_ledger (organization_id, renter_id, entry_type, amount)
  VALUES (v_org, v_renter, 'topup', 50000);

  v_result := renter_create_recurring_pack(jsonb_build_object(
    'renter_id', v_renter,
    'location_id', v_loc,
    'valid_from', v_pack_from,
    'valid_to', v_pack_to,
    'weekdays', jsonb_build_array(1, 3, 5),
    'time_start', v_slot_ts,
    'time_end', v_slot_te,
    'idempotency_key', 'fdb3-pack-active'
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'rich pack create');
  v_series := (v_result ->> 'series_id')::uuid;

  SELECT count(*) INTO v_outbox_n
  FROM renter_telegram_outbox
  WHERE organization_id = v_org
    AND event_type = 'booking_activated'
    AND dedupe_key = 'series_activated:' || v_series::text;
  PERFORM _test_assert(v_outbox_n = 1, 'one series activated outbox after topup activation');

  PERFORM _fdb3_set_renter_jwt(v_renter_user, v_org, v_renter, 97001);
  v_list := renter_list_mine(20, 0);
  PERFORM _test_assert((v_list ->> 'success')::boolean, 'list_mine success');
  v_item := (v_list -> 'items' -> 0);
  PERFORM _test_assert((v_item ->> 'series_occurrence_count')::int = 12, 'list_mine series_occurrence_count');
  PERFORM _test_assert(v_item ->> 'series_status' = 'active', 'list_mine series_status');

  RAISE NOTICE 'FDB3 series reliability/outbox/timeline tests passed';
END;
$$;

ROLLBACK;
