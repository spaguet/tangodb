-- FB2 / P1-09: unified quote/create validator — can_create, reasons, pack totals, fingerprint.
-- Run: npm run test:db:renter-miniapp-fb2

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

CREATE OR REPLACE FUNCTION _fb2_slot_at(p_org uuid, p_ahead interval)
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
  v_org uuid := 'fb200000-0000-4000-8000-000000000001';
  v_user uuid := 'fb200000-0000-4000-8000-000000000011';
  v_member uuid := 'fb200000-0000-4000-8000-000000000021';
  v_loc uuid := 'fb200000-0000-4000-8000-0000000000aa';
  v_renter uuid := 'fb200000-0000-4000-8000-000000000041';
  v_win_from date;
  v_win_to date;
  v_far date;
  v_far_ts text;
  v_far_te text;
  v_near date;
  v_near_ts text;
  v_near_te text;
  v_pack_from date;
  v_pack_to date;
  v_quote jsonb;
  v_create jsonb;
  v_def text;
  v_today date;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES (
    v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'fb2-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(),
    '{}'::jsonb, '{}'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'FB2 Quote Org', 'fb2-quote', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed', owner_user_id = EXCLUDED.owner_user_id;

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET license_type = 'lifetime', activated_at = now();

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'FB2 Owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, currency_code, locale)
  VALUES (v_org, 'Europe/Moscow', 'RUB', 'ru')
  ON CONFLICT (organization_id) DO UPDATE SET timezone = EXCLUDED.timezone;

  INSERT INTO locations (id, organization_id, name, miniapp_enabled)
  VALUES (v_loc, v_org, 'FB2 Hall', true)
  ON CONFLICT (id) DO UPDATE SET miniapp_enabled = true;

  INSERT INTO renters (id, organization_id, display_name, status, telegram_id)
  VALUES (v_renter, v_org, 'FB2 Renter', 'active', 96001)
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

  v_today := _org_local_date(v_org);
  SELECT window_start, window_end INTO v_win_from, v_win_to FROM _renter_occupancy_window(v_org);
  SELECT d, ts, te INTO v_far, v_far_ts, v_far_te FROM _fb2_slot_at(v_org, interval '72 hours');
  SELECT d, ts, te INTO v_near, v_near_ts, v_near_te FROM _fb2_slot_at(v_org, interval '20 minutes');

  -- tooSoon: unified validator flags <1h; create matches
  IF v_near = v_today
     AND _renter_slot_ts(v_org, v_near, v_near_ts) < now() + interval '1 hour' THEN
    v_quote := _renter_validate_one_time_booking(
      v_org, v_renter, v_loc, v_near, v_near_ts, v_near_te, 'one_time', true
    );
    PERFORM _test_assert((v_quote ->> 'can_create')::boolean IS FALSE, 'tooSoon validate can_create=false');
    PERFORM _test_assert(
      EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(v_quote -> 'reasons') r WHERE r = 'renter.booking.tooSoon'
      ),
      'tooSoon validate reason'
    );
    PERFORM _test_assert((v_quote ->> 'cost')::numeric > 0, 'tooSoon validate still returns cost');

    v_quote := renter_quote_booking(jsonb_build_object(
      'renter_id', v_renter,
      'location_id', v_loc,
      'rental_date', v_near,
      'time_start', v_near_ts,
      'time_end', v_near_te
    ));
    PERFORM _test_assert((v_quote ->> 'success')::boolean, 'tooSoon quote success: ' || COALESCE(v_quote ->> 'error', 'ok'));
    PERFORM _test_assert((v_quote ->> 'can_create')::boolean IS FALSE, 'tooSoon quote can_create=false');
  PERFORM _test_assert(
    EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(v_quote -> 'reasons') r WHERE r = 'renter.booking.tooSoon'
    ),
    'tooSoon quote reason'
  );
  PERFORM _test_assert((v_quote ->> 'cost')::numeric > 0, 'tooSoon quote still returns cost');
  PERFORM _test_assert(v_quote ->> 'fingerprint' IS NOT NULL, 'tooSoon quote fingerprint');

  v_create := renter_create_booking(jsonb_build_object(
    'renter_id', v_renter,
    'location_id', v_loc,
    'rental_date', v_near,
    'time_start', v_near_ts,
    'time_end', v_near_te,
    'idempotency_key', 'fb2-toosoon'
  ));
  PERFORM _test_assert(
    v_create ->> 'error' = 'renter.booking.tooSoon',
    'create tooSoon matches quote: ' || COALESCE(v_create ->> 'error', v_create::text)
  );
  ELSE
    RAISE NOTICE 'FB2: skip tooSoon parity (no slot <1h on today in window)';
  END IF;

  -- Valid one-time: quote can_create=true with wallet fields
  v_quote := renter_quote_booking(jsonb_build_object(
    'renter_id', v_renter,
    'location_id', v_loc,
    'rental_date', v_far,
    'time_start', v_far_ts,
    'time_end', v_far_te
  ));
  PERFORM _test_assert((v_quote ->> 'success')::boolean, 'valid quote: ' || COALESCE(v_quote ->> 'error', 'ok'));
  PERFORM _test_assert((v_quote ->> 'can_create')::boolean, 'valid quote can_create');
  PERFORM _test_assert((v_quote ->> 'prepay')::numeric = (v_quote ->> 'cost')::numeric / 2, 'quote 50% prepay');
  PERFORM _test_assert((v_quote ->> 'balance')::numeric >= 0, 'quote balance present');
  PERFORM _test_assert((v_quote ->> 'shortage') IS NOT NULL, 'quote shortage present');

  -- Pack: first weekday must match valid_from (Monday start, Tuesday-only pattern)
  v_pack_from := v_win_from;
  v_pack_to := v_pack_from + 27;

  v_quote := renter_quote_booking(jsonb_build_object(
    'renter_id', v_renter,
    'location_id', v_loc,
    'valid_from', v_pack_from,
    'valid_to', v_pack_to,
    'weekdays', jsonb_build_array(2),
    'time_start', '15:00',
    'time_end', '16:00'
  ));
  PERFORM _test_assert((v_quote ->> 'success')::boolean, 'pack weekday mismatch quote');
  PERFORM _test_assert((v_quote ->> 'can_create')::boolean IS FALSE, 'pack weekday mismatch can_create=false');
  PERFORM _test_assert(
    EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(v_quote -> 'reasons') r WHERE r = 'renter.booking.packWindow'
    ),
    'pack weekday mismatch reason'
  );

  v_create := renter_create_recurring_pack(jsonb_build_object(
    'renter_id', v_renter,
    'location_id', v_loc,
    'valid_from', v_pack_from,
    'valid_to', v_pack_to,
    'weekdays', jsonb_build_array(2),
    'time_start', '15:00',
    'time_end', '16:00',
    'idempotency_key', 'fb2-pack-bad-dow'
  ));
  PERFORM _test_assert(
    (v_create ->> 'success') IS DISTINCT FROM 'true',
    'create pack weekday rejected: ' || COALESCE(v_create ->> 'error', v_create::text)
  );
  PERFORM _test_assert(
    EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(v_quote -> 'reasons') r
      WHERE r = v_create ->> 'error'
    ),
    'create pack weekday error matches quote reasons'
  );

  -- Pack success: totals at pack level (4 Mondays from window start)
  v_pack_from := v_win_from;
  v_pack_to := v_pack_from + 27;

  v_quote := renter_quote_booking(jsonb_build_object(
    'renter_id', v_renter,
    'location_id', v_loc,
    'valid_from', v_pack_from,
    'valid_to', v_pack_to,
    'weekdays', jsonb_build_array(1),
    'time_start', '15:00',
    'time_end', '16:00'
  ));
  PERFORM _test_assert((v_quote ->> 'success')::boolean, 'pack quote ok: ' || COALESCE(v_quote ->> 'error', 'ok'));
  PERFORM _test_assert((v_quote ->> 'occurrence_count')::int = 4, 'pack 4 Mondays in 4 weeks');
  PERFORM _test_assert((v_quote ->> 'cost')::numeric = 4000, 'pack total cost 4×1000');
  PERFORM _test_assert((v_quote ->> 'prepay')::numeric = 2000, 'pack total prepay 50%');
  PERFORM _test_assert((v_quote ->> 'remainder')::numeric = 2000, 'pack total remainder');
  PERFORM _test_assert(v_quote ->> 'fingerprint' IS NOT NULL, 'pack fingerprint');

  v_def := pg_get_functiondef('renter_create_booking(jsonb)'::regprocedure);
  PERFORM _test_assert(v_def LIKE '%_renter_validate_one_time_booking%', 'create uses unified one-time validator');
  v_def := pg_get_functiondef('renter_create_recurring_pack(jsonb)'::regprocedure);
  PERFORM _test_assert(v_def LIKE '%_renter_validate_pack_booking%', 'pack create uses unified pack validator');
  v_def := pg_get_functiondef('renter_quote_booking(jsonb)'::regprocedure);
  PERFORM _test_assert(v_def LIKE '%_renter_validate_one_time_booking%', 'quote uses unified one-time validator');

  RAISE NOTICE 'FB2 quote validator tests passed';
END;
$$;

ROLLBACK;
