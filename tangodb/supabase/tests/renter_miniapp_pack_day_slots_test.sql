-- Per-weekday pack hours (day_slots). Run: npm run test:db:renter-miniapp-pack-day-slots

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
  v_slots jsonb;
  v_fp_old text;
  v_fp_new text;
  v_fp_mixed text;
  v_version_id uuid;
  v_org uuid := 'fd100000-0000-4000-8000-000000000001';
  v_user uuid := 'fd100000-0000-4000-8000-000000000011';
  v_member uuid := 'fd100000-0000-4000-8000-000000000021';
  v_loc uuid := 'fd100000-0000-4000-8000-0000000000aa';
  v_renter uuid := 'fd100000-0000-4000-8000-000000000041';
  v_win_from date;
  v_pack_to date;
  v_quote jsonb;
  v_create jsonb;
  v_series uuid;
  v_pattern_n int;
  v_time_n int;
  v_occ jsonb;
BEGIN
  v_slots := _renter_pack_day_slots_canonical(jsonb_build_object(
    'weekdays', jsonb_build_array(5, 1, 3),
    'time_start', '18:00',
    'time_end', '20:00'
  ));
  PERFORM _test_assert(
    v_slots = jsonb_build_array(
      jsonb_build_object('weekday', 1, 'time_start', '18:00', 'time_end', '20:00'),
      jsonb_build_object('weekday', 3, 'time_start', '18:00', 'time_end', '20:00'),
      jsonb_build_object('weekday', 5, 'time_start', '18:00', 'time_end', '20:00')
    ),
    'legacy weekdays expand to sorted slots'
  );

  v_slots := _renter_pack_day_slots_canonical(jsonb_build_object(
    'day_slots', jsonb_build_array(
      jsonb_build_object('weekday', 5, 'time_start', '11:00', 'time_end', '12:00'),
      jsonb_build_object('weekday', 1, 'time_start', '09:00', 'time_end', '10:00'),
      jsonb_build_object('day_of_week', 3, 'time_start', '10:00', 'time_end', '11:30')
    )
  ));
  PERFORM _test_assert(
    (v_slots -> 0 ->> 'weekday') = '1' AND (v_slots -> 0 ->> 'time_start') = '09:00',
    'day_slots sorted; Monday 09:00'
  );
  PERFORM _test_assert((v_slots -> 1 ->> 'time_start') = '10:00', 'Wednesday 10:00');
  PERFORM _test_assert((v_slots -> 2 ->> 'time_end') = '12:00', 'Friday 12:00');

  v_slots := _renter_pack_day_slots_canonical(jsonb_build_object(
    'day_slots', jsonb_build_array(
      jsonb_build_object('weekday', 1, 'time_start', '09:00', 'time_end', '10:00'),
      jsonb_build_object('weekday', 1, 'time_start', '11:00', 'time_end', '12:00')
    )
  ));
  PERFORM _test_assert(v_slots = '[]'::jsonb, 'duplicate weekday rejected');

  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES (
    v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'fd1-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(),
    '{}'::jsonb, '{}'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'FD1 Day Slots Org', 'fd1-day-slots', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed', owner_user_id = EXCLUDED.owner_user_id;

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET license_type = 'lifetime', activated_at = now();

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'FD1 Owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, currency_code, locale)
  VALUES (v_org, 'Europe/Moscow', 'RUB', 'ru')
  ON CONFLICT (organization_id) DO UPDATE SET timezone = EXCLUDED.timezone;

  INSERT INTO locations (id, organization_id, name, miniapp_enabled)
  VALUES (v_loc, v_org, 'FD1 Hall', true)
  ON CONFLICT (id) DO UPDATE SET miniapp_enabled = true;

  INSERT INTO renters (id, organization_id, display_name, status, telegram_id)
  VALUES (v_renter, v_org, 'FD1 Renter', 'active', 96101)
  ON CONFLICT (id) DO UPDATE SET status = 'active', telegram_id = EXCLUDED.telegram_id;

  INSERT INTO organization_addons (organization_id, addon_code, status, period_start, period_end)
  VALUES (v_org, 'renter_miniapp', 'active', CURRENT_DATE - 1, CURRENT_DATE + 365)
  ON CONFLICT (organization_id, addon_code) DO UPDATE SET status = 'active';

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

  SELECT window_start INTO v_win_from FROM _renter_occupancy_window(v_org);
  v_pack_to := v_win_from + 27;

  v_fp_old := _renter_pack_payload_fingerprint(
    v_loc, v_win_from, v_pack_to, ARRAY[1, 3], '15:00', '16:00', v_renter
  );
  v_fp_new := _renter_pack_payload_fingerprint_slots(
    v_loc,
    v_win_from,
    v_pack_to,
    _renter_pack_day_slots_from_weekdays(ARRAY[1, 3], '15:00', '16:00'),
    v_renter
  );
  PERFORM _test_assert(v_fp_old = v_fp_new, 'uniform slots fingerprint matches legacy');

  v_fp_mixed := _renter_pack_payload_fingerprint_slots(
    v_loc,
    v_win_from,
    v_pack_to,
    jsonb_build_array(
      jsonb_build_object('weekday', 1, 'time_start', '15:00', 'time_end', '16:00'),
      jsonb_build_object('weekday', 3, 'time_start', '17:00', 'time_end', '18:00')
    ),
    v_renter
  );
  PERFORM _test_assert(v_fp_mixed IS DISTINCT FROM v_fp_old, 'mixed hours change fingerprint');

  v_quote := renter_quote_booking(jsonb_build_object(
    'renter_id', v_renter,
    'location_id', v_loc,
    'valid_from', v_win_from,
    'valid_to', v_pack_to,
    'weekdays', jsonb_build_array(1, 3),
    'time_start', '15:00',
    'time_end', '16:00'
  ));
  PERFORM _test_assert((v_quote ->> 'success')::boolean, 'legacy pack quote: ' || COALESCE(v_quote ->> 'error', 'ok'));
  PERFORM _test_assert((v_quote ->> 'occurrence_count')::int = 8, 'legacy 2 weekdays × 4 weeks');

  v_quote := renter_quote_booking(jsonb_build_object(
    'renter_id', v_renter,
    'location_id', v_loc,
    'valid_from', v_win_from,
    'valid_to', v_pack_to,
    'day_slots', jsonb_build_array(
      jsonb_build_object('weekday', 1, 'time_start', '15:00', 'time_end', '16:00'),
      jsonb_build_object('weekday', 3, 'time_start', '17:00', 'time_end', '18:30')
    )
  ));
  PERFORM _test_assert((v_quote ->> 'success')::boolean, 'mixed pack quote: ' || COALESCE(v_quote ->> 'error', 'ok'));
  PERFORM _test_assert((v_quote ->> 'can_create')::boolean, 'mixed pack can_create');
  PERFORM _test_assert((v_quote ->> 'occurrence_count')::int = 8, 'mixed 8 occurrences');
  PERFORM _test_assert((v_quote ->> 'cost')::numeric = 10000, 'mixed cost 4×1000 + 4×1500');

  PERFORM _test_assert(
    (
      SELECT bool_and(
        CASE
          WHEN EXTRACT(ISODOW FROM (e ->> 'date')::date) = 1 THEN
            (e ->> 'time_start') = '15:00' AND (e ->> 'time_end') = '16:00'
          WHEN EXTRACT(ISODOW FROM (e ->> 'date')::date) = 3 THEN
            (e ->> 'time_start') = '17:00' AND (e ->> 'time_end') = '18:30'
          ELSE false
        END
      )
      FROM jsonb_array_elements(v_quote -> 'occurrences') e
    ),
    'quote occurrences keep per-weekday hours'
  );

  v_create := renter_create_recurring_pack(jsonb_build_object(
    'renter_id', v_renter,
    'location_id', v_loc,
    'valid_from', v_win_from,
    'valid_to', v_pack_to,
    'day_slots', jsonb_build_array(
      jsonb_build_object('weekday', 1, 'time_start', '15:00', 'time_end', '16:00'),
      jsonb_build_object('weekday', 3, 'time_start', '17:00', 'time_end', '18:30')
    ),
    'idempotency_key', 'fd1-mixed-hours'
  ));
  PERFORM _test_assert((v_create ->> 'success')::boolean, 'mixed pack create: ' || COALESCE(v_create ->> 'error', v_create::text));
  v_series := (v_create ->> 'series_id')::uuid;

  SELECT count(*) INTO v_pattern_n FROM rental_series_patterns WHERE series_id = v_series;
  PERFORM _test_assert(v_pattern_n = 2, 'two series patterns');

  SELECT count(DISTINCT time_start) INTO v_time_n
  FROM rentals
  WHERE rental_series_id = v_series AND booking_status = 'confirmed';
  PERFORM _test_assert(v_time_n = 2, 'created rentals use two start times');

  SELECT jsonb_agg(jsonb_build_object('dow', EXTRACT(ISODOW FROM rental_date)::int, 'ts', time_start, 'te', time_end))
  INTO v_occ
  FROM rentals
  WHERE rental_series_id = v_series AND booking_status = 'confirmed';

  PERFORM _test_assert(
    (
      SELECT bool_and(
        CASE
          WHEN (e ->> 'dow')::int = 1 THEN (e ->> 'ts') = '15:00' AND (e ->> 'te') = '16:00'
          WHEN (e ->> 'dow')::int = 3 THEN (e ->> 'ts') = '17:00' AND (e ->> 'te') = '18:30'
          ELSE false
        END
      )
      FROM jsonb_array_elements(v_occ) e
    ),
    'created rentals match day slots'
  );

  RAISE NOTICE 'pack day_slots tests passed';
END;
$$;

ROLLBACK;
