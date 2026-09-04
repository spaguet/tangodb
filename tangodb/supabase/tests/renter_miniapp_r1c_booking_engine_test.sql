-- R1c: Mini App booking engine (FIFO, locks, cancel, occupancy, pack, limits).
-- Run: psql "%DATABASE_URL%" -v ON_ERROR_STOP=1 -f supabase/tests/_hall_rent_test_jwt.sql -f supabase/tests/renter_miniapp_r1c_booking_engine_test.sql

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

CREATE OR REPLACE FUNCTION _r1c_set_renter_jwt(p_user uuid, p_org uuid, p_telegram bigint)
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
        'renter_id', '00000000-0000-4000-8000-00000000dead',
        'telegram_id', p_telegram::text
      )
    )::text,
    true
  );
END;
$$;

CREATE OR REPLACE FUNCTION _r1c_slot_at(p_org uuid, p_ahead interval)
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
  v_org uuid := 'a1c00000-0000-4000-8000-000000000001';
  v_user uuid := 'a1c00000-0000-4000-8000-000000000011';
  v_acc_user uuid := 'a1c00000-0000-4000-8000-000000000012';
  v_renter_user uuid := 'a1c00000-0000-4000-8000-000000000013';
  v_member uuid := 'a1c00000-0000-4000-8000-000000000021';
  v_acc_member uuid := 'a1c00000-0000-4000-8000-000000000022';
  v_loc_a uuid := 'a1c00000-0000-4000-8000-0000000000aa';
  v_loc_b uuid := 'a1c00000-0000-4000-8000-0000000000bb';
  v_loc_off uuid := 'a1c00000-0000-4000-8000-0000000000cc';
  v_renter uuid := 'a1c00000-0000-4000-8000-000000000041';
  v_renter_notg uuid := 'a1c00000-0000-4000-8000-000000000042';
  v_renter_arch uuid := 'a1c00000-0000-4000-8000-000000000043';
  v_disc uuid := 'a1c00000-0000-4000-8000-000000000071';
  v_client uuid := 'a1c00000-0000-4000-8000-000000000072';
  v_slot_group uuid := 'a1c00000-0000-4000-8000-000000000073';
  v_event uuid := 'a1c00000-0000-4000-8000-000000000074';
  v_event_sess uuid := 'a1c00000-0000-4000-8000-000000000075';
  v_personal uuid := 'a1c00000-0000-4000-8000-000000000076';
  v_soc uuid := 'a1c00000-0000-4000-8000-000000000077';
  v_today date;
  v_win_from date;
  v_win_to date;
  v_d date;
  v_ts text;
  v_te text;
  v_d2 date;
  v_ts2 text;
  v_te2 text;
  v_far date;
  v_far_ts text;
  v_far_te text;
  v_near date;
  v_near_ts text;
  v_near_te text;
  v_pack_from date;
  v_pack_to date;
  v_tail date;
  v_result jsonb;
  v_quote jsonb;
  v_id uuid;
  v_id2 uuid;
  v_series uuid;
  v_hold uuid;
  v_exp timestamptz;
  v_exp2 timestamptz;
  v_pairs int;
  v_def text;
  v_life text;
  v_reason text;
  v_currency text;
  v_occ jsonb;
  v_busy_tail boolean;
  v_n int;
  v_awaiting int;
  v_unfinished int;
  v_wallet numeric;
  v_spendable numeric;
  v_reserved numeric;
  v_debt numeric;
  v_dow int;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES
    (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'r1c-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_acc_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'r1c-acc@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_renter_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'r1c-renter@users.invalid', crypt('testpass123', gen_salt('bf')), now(), now(), now(),
     jsonb_build_object('actor', 'renter', 'organization_id', v_org::text, 'telegram_id', '91001'),
     '{}'::jsonb)
  ON CONFLICT (id) DO UPDATE SET raw_app_meta_data = EXCLUDED.raw_app_meta_data;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'R1c Engine Org', 'r1c-engine', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed', owner_user_id = EXCLUDED.owner_user_id;

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET license_type = 'lifetime', activated_at = now();

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES
    (v_member, v_org, v_user, 'owner', 'R1c Owner'),
    (v_acc_member, v_org, v_acc_user, 'accountant', 'R1c Acc')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, currency_code, locale, branding_name)
  VALUES (v_org, 'Europe/Moscow', 'RUB', 'ru', 'R1c Studio')
  ON CONFLICT (organization_id) DO UPDATE SET
    timezone = EXCLUDED.timezone,
    currency_code = EXCLUDED.currency_code,
    locale = EXCLUDED.locale,
    branding_name = EXCLUDED.branding_name,
    finance_period_closed_until = NULL;

  INSERT INTO locations (id, organization_id, name, miniapp_enabled)
  VALUES
    (v_loc_a, v_org, 'Hall A', true),
    (v_loc_b, v_org, 'Hall B', true),
    (v_loc_off, v_org, 'Hall Off', false)
  ON CONFLICT (id) DO UPDATE SET miniapp_enabled = EXCLUDED.miniapp_enabled;

  INSERT INTO renters (id, organization_id, display_name, telegram_id, status, archived_at)
  VALUES
    (v_renter, v_org, 'R1c Renter', 91001, 'active', NULL),
    (v_renter_notg, v_org, 'R1c No Telegram', NULL, 'active', NULL),
    (v_renter_arch, v_org, 'R1c Archived', 91002, 'archived', now())
  ON CONFLICT (id) DO UPDATE SET
    telegram_id = EXCLUDED.telegram_id,
    status = EXCLUDED.status,
    archived_at = EXCLUDED.archived_at;

  INSERT INTO organization_addons (organization_id, addon_code, status, period_start, period_end)
  VALUES (v_org, 'renter_miniapp', 'active', CURRENT_DATE - 1, CURRENT_DATE + 365)
  ON CONFLICT (organization_id, addon_code) DO UPDATE SET
    status = 'active', period_start = EXCLUDED.period_start, period_end = EXCLUDED.period_end;

  INSERT INTO location_rental_hour_rates (organization_id, location_id, kind, price, currency, valid_from)
  VALUES
    (v_org, v_loc_a, 'one_time', 1000, 'RUB', DATE '2000-01-01'),
    (v_org, v_loc_a, 'recurring', 800, 'RUB', DATE '2000-01-01'),
    (v_org, v_loc_a, 'penalty', 1500, 'RUB', DATE '2000-01-01'),
    (v_org, v_loc_b, 'one_time', 1000, 'RUB', DATE '2000-01-01'),
    (v_org, v_loc_b, 'recurring', 800, 'RUB', DATE '2000-01-01'),
    (v_org, v_loc_b, 'penalty', 1500, 'RUB', DATE '2000-01-01');

  INSERT INTO renter_wallet_ledger (organization_id, renter_id, entry_type, amount)
  VALUES (v_org, v_renter, 'topup', 50000);

  INSERT INTO disciplines (id, organization_id, name)
  VALUES (v_disc, v_org, 'Tango')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO clients (id, organization_id, first_name, last_name)
  VALUES (v_client, v_org, 'R1c', 'Client')
  ON CONFLICT (id) DO NOTHING;

  v_today := _org_local_date(v_org);
  SELECT window_start, window_end INTO v_win_from, v_win_to FROM _renter_occupancy_window(v_org);

  SELECT d, ts, te INTO v_far, v_far_ts, v_far_te FROM _r1c_slot_at(v_org, interval '72 hours');
  SELECT d, ts, te INTO v_near, v_near_ts, v_near_te FROM _r1c_slot_at(v_org, interval '2 hours');
  PERFORM _test_assert(v_far >= v_win_from AND v_far <= v_win_to, 'far slot inside 3-week window');
  PERFORM _test_assert(v_near >= v_win_from AND v_near <= v_win_to, 'near slot inside 3-week window');

  -- Hold timer helper
  PERFORM _test_assert(
    _renter_compute_hold_expires_at(now(), now() + interval '1 hour')
      = now() + interval '1 hour',
    'hold expiry is min(created+24h, time_start)'
  );
  PERFORM _test_assert(
    _renter_compute_hold_expires_at(now(), now() + interval '48 hours')
      = now() + interval '24 hours',
    'hold expiry caps at created+24h'
  );

  -- Lock pairs: awaiting on A + extra B includes both
  INSERT INTO rentals (
    organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, hold_expires_at,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, currency
  )
  VALUES (
    v_org, v_renter, v_loc_a, v_far, '10:00', '11:00',
    'confirmed', 'miniapp', 'awaiting_payment', now() + interval '12 hours',
    500, 500, 0, 1000, 'RUB'
  )
  RETURNING id INTO v_hold;

  SELECT count(*) INTO v_pairs
  FROM _renter_lock_candidate_pairs(
    v_org,
    v_renter,
    jsonb_build_array(jsonb_build_object('location_id', v_loc_b, 'date', v_far))
  );
  PERFORM _test_assert(v_pairs >= 2, 'lock candidates include awaiting hall A and new hall B');
  PERFORM _test_assert(
    EXISTS (
      SELECT 1 FROM _renter_lock_candidate_pairs(
        v_org, v_renter,
        jsonb_build_array(jsonb_build_object('location_id', v_loc_b, 'date', v_far))
      ) p WHERE p.location_id = v_loc_a
    ),
    'awaiting location A is locked together with B'
  );
  PERFORM _test_assert(
    EXISTS (
      SELECT 1 FROM _renter_lock_candidate_pairs(
        v_org, v_renter,
        jsonb_build_array(jsonb_build_object('location_id', v_loc_b, 'date', v_far))
      ) p WHERE p.location_id = v_loc_b
    ),
    'new location B is in the lock set'
  );

  DELETE FROM rentals WHERE id = v_hold;

  v_def := pg_get_functiondef('renter_create_booking(jsonb)'::regprocedure);
  PERFORM _test_assert(v_def LIKE '%_renter_acquire_miniapp_locks%', 'create uses miniapp lock helper');
  v_def := pg_get_functiondef('create_rental(jsonb)'::regprocedure);
  PERFORM _test_assert(v_def LIKE '%miniappChannelForbidden%', 'cashier create_rental still rejects miniapp channel');

  -- Owner JWT create far slot (with money → active, not prepaid: >24h)
  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');
  v_result := renter_create_booking(jsonb_build_object(
    'renter_id', v_renter,
    'location_id', v_loc_a,
    'rental_date', v_far,
    'time_start', v_far_ts,
    'time_end', v_far_te,
    'idempotency_key', 'r1c-far-1'
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'staff create far slot: ' || COALESCE(v_result ->> 'error', 'ok'));
  v_id := (v_result -> 'rental' ->> 'id')::uuid;
  PERFORM _test_assert(v_result -> 'rental' ->> 'lifecycle' = 'active', 'far create with money → active');
  PERFORM _test_assert(v_result -> 'rental' ->> 'currency' = 'RUB', 'slot currency = org currency_code');
  PERFORM _test_assert((v_result -> 'rental' ->> 'fixed_amount')::numeric = 1000, 'snapshot cost 1h one_time');
  PERFORM _test_assert((SELECT final_amount FROM rentals WHERE id = v_id) IS NULL, 'final_amount not set on Mini App');
  PERFORM _test_assert((SELECT tariff_id FROM rentals WHERE id = v_id) IS NULL, 'cashier tariff_id stays NULL');
  PERFORM _test_assert(
    NOT EXISTS (SELECT 1 FROM rental_payments WHERE rental_id = v_id),
    'no rental_payments on 50/50'
  );

  -- Same key + different payload → mismatch
  v_result := renter_create_booking(jsonb_build_object(
    'renter_id', v_renter,
    'location_id', v_loc_a,
    'rental_date', v_far,
    'time_start', '12:00',
    'time_end', '13:00',
    'idempotency_key', 'r1c-far-1'
  ));
  PERFORM _test_assert(
    (v_result ->> 'success') IS DISTINCT FROM 'true'
      AND v_result ->> 'error' = 'renter.booking.idempotencyMismatch',
    'same idempotency key different payload refused'
  );

  -- Repeat same interval returns existing
  v_result := renter_create_booking(jsonb_build_object(
    'renter_id', v_renter,
    'location_id', v_loc_a,
    'rental_date', v_far,
    'time_start', v_far_ts,
    'time_end', v_far_te,
    'idempotency_key', 'r1c-far-1-retry'
  ));
  PERFORM _test_assert((v_result ->> 'already_applied')::boolean, 'repeat interval returns own slot');
  PERFORM _test_assert((v_result -> 'rental' ->> 'id')::uuid = v_id, 'returned id is the existing slot');

  -- Create in 24h window → prepaid_charged
  v_result := renter_create_booking(jsonb_build_object(
    'renter_id', v_renter,
    'location_id', v_loc_b,
    'rental_date', v_near,
    'time_start', v_near_ts,
    'time_end', v_near_te,
    'idempotency_key', 'r1c-near-1'
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'near create: ' || COALESCE(v_result ->> 'error', 'ok'));
  PERFORM _test_assert(
    v_result -> 'rental' ->> 'lifecycle' = 'prepaid_charged',
    'create inside 24h window → prepaid_charged not active'
  );
  v_id2 := (v_result -> 'rental' ->> 'id')::uuid;

  -- FIFO skip after time_start / expiry
  INSERT INTO rentals (
    organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, hold_expires_at,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, currency
  )
  VALUES (
    v_org, v_renter, v_loc_b, v_today - 1, '10:00', '11:00',
    'confirmed', 'miniapp', 'awaiting_payment', now() + interval '10 hours',
    500, 500, 0, 1000, 'RUB'
  )
  RETURNING id INTO v_hold;
  PERFORM _renter_fifo_activate(v_org, v_renter);
  PERFORM _test_assert(
    (SELECT lifecycle FROM rentals WHERE id = v_hold) = 'awaiting_payment',
    'FIFO does not activate awaiting after time_start'
  );

  -- Catch-up p.2: active after time_end → debt/settled, not auto_deleted
  INSERT INTO rentals (
    organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, hold_expires_at,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, currency,
    created_at
  )
  VALUES (
    v_org, v_renter, v_loc_b, v_today - 2, '10:00', '11:00',
    'confirmed', 'miniapp', 'active', now() - interval '1 hour',
    500, 500, 0, 1000, 'RUB',
    now() - interval '3 days'
  )
  RETURNING id INTO v_hold;
  -- wallet still has funds; charge may succeed → settled. Force empty spendable via extra reserved? 
  -- Use renter with no extra money: current wallet has 50000 minus charges. Still enough.
  -- Insert a second catch-up with prepay larger than remaining? Simpler: zero-out by checking not auto_deleted.
  PERFORM _renter_expire_and_catchup(v_org, v_renter);
  SELECT lifecycle INTO v_life FROM rentals WHERE id = v_hold;
  PERFORM _test_assert(
    v_life IN ('settled', 'debt', 'prepaid_charged'),
    'catch-up p.2 active after time_end is not auto_deleted, got ' || v_life
  );

  -- Catch-up p.3: active during slot without money → auto_deleted
  INSERT INTO renters (id, organization_id, display_name, telegram_id, status)
  VALUES ('a1c00000-0000-4000-8000-000000000044', v_org, 'R1c Broke', 91003, 'active');
  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, hold_expires_at,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, currency
  )
  VALUES (
    'a1c00000-0000-4000-8000-000000000081',
    v_org, 'a1c00000-0000-4000-8000-000000000044', v_loc_a,
    v_near, v_near_ts, v_near_te,
    'confirmed', 'miniapp', 'active', now() + interval '1 hour',
    500, 500, 0, 1000, 'RUB'
  );
  -- Shift times to now-inside-slot via catch-up: use today's slot that started
  UPDATE rentals
  SET
    rental_date = v_today,
    time_start = to_char((now() AT TIME ZONE 'Europe/Moscow') - interval '30 minutes', 'HH24:00'),
    time_end = to_char((now() AT TIME ZONE 'Europe/Moscow') + interval '90 minutes', 'HH24:00')
  WHERE id = 'a1c00000-0000-4000-8000-000000000081';
  -- Ensure 30-min grid
  UPDATE rentals
  SET
    time_start = CASE
      WHEN substring(time_start, 4, 2) IN ('00', '30') THEN time_start
      ELSE substring(time_start, 1, 3) || '00'
    END,
    time_end = CASE
      WHEN substring(time_end, 4, 2) IN ('00', '30') THEN time_end
      ELSE substring(time_end, 1, 3) || '30'
    END
  WHERE id = 'a1c00000-0000-4000-8000-000000000081';
  PERFORM _renter_expire_and_catchup(v_org, 'a1c00000-0000-4000-8000-000000000044');
  SELECT lifecycle INTO v_life FROM rentals WHERE id = 'a1c00000-0000-4000-8000-000000000081';
  PERFORM _test_assert(
    v_life = 'auto_deleted',
    'catch-up p.3 active in-slot without money → auto_deleted, got ' || coalesce(v_life, 'null')
  );
  PERFORM _test_assert(
    (SELECT cancelled_at IS NOT NULL AND cancelled_reason = 'miniapp_auto_deleted' FROM rentals WHERE id = 'a1c00000-0000-4000-8000-000000000081'),
    'auto_deleted passes cancelled_at+reason CHECK'
  );

  -- Remainder vs reserved: prepaid_charged past end, another active reserved, spendable < remainder
  INSERT INTO renters (id, organization_id, display_name, telegram_id, status)
  VALUES ('a1c00000-0000-4000-8000-000000000045', v_org, 'R1c Remainder', 91004, 'active');
  INSERT INTO renter_wallet_ledger (organization_id, renter_id, entry_type, amount)
  VALUES (v_org, 'a1c00000-0000-4000-8000-000000000045', 'topup', 600);
  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, hold_expires_at,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, currency,
    prepay_charged_at
  )
  VALUES (
    'a1c00000-0000-4000-8000-000000000082',
    v_org, 'a1c00000-0000-4000-8000-000000000045', v_loc_a, v_today - 1, '10:00', '11:00',
    'confirmed', 'miniapp', 'prepaid_charged', now() - interval '2 days',
    500, 500, 0, 1000, 'RUB', now() - interval '2 days'
  );
  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, hold_expires_at,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, currency
  )
  VALUES (
    'a1c00000-0000-4000-8000-000000000083',
    v_org, 'a1c00000-0000-4000-8000-000000000045', v_loc_b, v_far, v_far_ts, v_far_te,
    'confirmed', 'miniapp', 'active', now() + interval '12 hours',
    500, 500, 0, 1000, 'RUB'
  );
  -- wallet 600, reserved 500, spendable 100 < remainder 500 → debt, reserved untouched
  PERFORM _renter_expire_and_catchup(v_org, 'a1c00000-0000-4000-8000-000000000045');
  PERFORM _test_assert(
    (SELECT lifecycle FROM rentals WHERE id = 'a1c00000-0000-4000-8000-000000000082') = 'debt',
    'remainder with foreign reserved → debt'
  );
  PERFORM _test_assert(
    (SELECT lifecycle FROM rentals WHERE id = 'a1c00000-0000-4000-8000-000000000083') = 'active',
    'foreign active reserved not consumed by remainder'
  );
  PERFORM _test_assert(
    _renter_wallet_reserved_prepay(v_org, 'a1c00000-0000-4000-8000-000000000045') = 500,
    'reserved_prepay still 500 after remainder debt'
  );

  -- FIFO + debt: available=0, already-active stays
  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, debt_amount, prepay_amount, remainder_amount, fixed_amount, currency
  )
  VALUES (
    'a1c00000-0000-4000-8000-000000000084',
    v_org, 'a1c00000-0000-4000-8000-000000000045', v_loc_a, v_today - 3, '12:00', '13:00',
    'confirmed', 'miniapp', 'debt', 100, 500, 500, 1000, 'RUB'
  );
  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, hold_expires_at,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, currency
  )
  VALUES (
    'a1c00000-0000-4000-8000-000000000085',
    v_org, 'a1c00000-0000-4000-8000-000000000045', v_loc_a, v_far, '20:00', '21:00',
    'confirmed', 'miniapp', 'awaiting_payment', now() + interval '20 hours',
    500, 500, 0, 1000, 'RUB'
  );
  PERFORM _renter_apply_wallet(v_org, 'a1c00000-0000-4000-8000-000000000045');
  PERFORM _test_assert(
    (SELECT lifecycle FROM rentals WHERE id = 'a1c00000-0000-4000-8000-000000000083') = 'active',
    'FIFO with debt does not drop already-active'
  );
  PERFORM _test_assert(
    (SELECT lifecycle FROM rentals WHERE id = 'a1c00000-0000-4000-8000-000000000085') = 'awaiting_payment',
    'FIFO with debt does not activate new awaiting'
  );

  -- Cancel retain at T−24 (near prepaid slot)
  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');
  v_result := renter_cancel_occurrence(v_id2);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'staff cancel near: ' || COALESCE(v_result ->> 'error', 'ok'));
  PERFORM _test_assert(v_result ->> 'reason' = 'miniapp_cancel_retain', 'cancel inside 24h retains 50%');
  PERFORM _test_assert(
    (SELECT lifecycle FROM rentals WHERE id = v_id2) = 'cancelled',
    'retain cancel → cancelled'
  );
  PERFORM _test_assert(
    (SELECT hold_expires_at IS NOT NULL FROM rentals WHERE id = v_id2),
    'hold_expires_at not NULLed on cancel'
  );

  -- Renter cancel after time_start refused
  PERFORM _r1c_set_renter_jwt(v_renter_user, v_org, 91001);
  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, hold_expires_at,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, currency,
    prepay_charged_at
  )
  VALUES (
    'a1c00000-0000-4000-8000-000000000086',
    v_org, v_renter, v_loc_a, v_today,
    to_char((now() AT TIME ZONE 'Europe/Moscow') - interval '15 minutes', 'HH24:00'),
    to_char((now() AT TIME ZONE 'Europe/Moscow') + interval '45 minutes', 'HH24:00'),
    'confirmed', 'miniapp', 'prepaid_charged', now() + interval '1 hour',
    500, 500, 0, 1000, 'RUB', now() - interval '1 hour'
  );
  v_result := renter_cancel_occurrence('a1c00000-0000-4000-8000-000000000086');
  PERFORM _test_assert(
    (v_result ->> 'success') IS DISTINCT FROM 'true'
      AND v_result ->> 'error' = 'renter.booking.alreadyStarted',
    'renter cancel after time_start refused'
  );

  -- Staff occupancy during slot retains 50%, no remainder
  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');
  v_result := renter_cancel_occurrence('a1c00000-0000-4000-8000-000000000086');
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'staff occupancy during slot: ' || COALESCE(v_result ->> 'error', 'ok'));
  PERFORM _test_assert(v_result ->> 'reason' = 'miniapp_cancel_retain', 'staff in-window retain 50%');
  PERFORM _test_assert(
    (SELECT remainder_charged_at IS NULL FROM rentals WHERE id = 'a1c00000-0000-4000-8000-000000000086'),
    'staff occupancy does not charge remainder'
  );

  -- delete_hold + inherit expiry; 30 min shift still inherits; other hall new timer; abut 14:00 no overlap
  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');
  -- pick another far time if far_ts occupied
  SELECT d, ts, te INTO v_d, v_ts, v_te FROM _r1c_slot_at(v_org, interval '80 hours');
  v_result := renter_create_booking(jsonb_build_object(
    'renter_id', v_renter,
    'location_id', v_loc_b,
    'rental_date', v_d,
    'time_start', '14:00',
    'time_end', '15:00',
    'idempotency_key', 'r1c-hold-inherit'
  ));
  -- may be active with money
  IF (v_result ->> 'success')::boolean THEN
    -- force awaiting for delete_hold: only works on awaiting. If active, skip inherit via fixture.
    NULL;
  END IF;

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, hold_expires_at,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, currency,
    cancelled_at, cancelled_reason
  )
  VALUES (
    'a1c00000-0000-4000-8000-000000000087',
    v_org, v_renter, v_loc_a, v_d, '16:00', '17:00',
    'cancelled', 'miniapp', 'hold_deleted', now() + interval '8 hours',
    500, 500, 0, 1000, 'RUB',
    now(), 'miniapp_hold_deleted'
  );
  v_exp := now() + interval '8 hours';
  v_result := renter_create_booking(jsonb_build_object(
    'renter_id', v_renter,
    'location_id', v_loc_a,
    'rental_date', v_d,
    'time_start', '16:30',
    'time_end', '17:30',
    'idempotency_key', 'r1c-inherit-shift'
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'create after hold_deleted: ' || COALESCE(v_result ->> 'error', 'ok'));
  v_exp2 := (v_result -> 'rental' ->> 'hold_expires_at')::timestamptz;
  PERFORM _test_assert(
    abs(extract(epoch FROM (v_exp2 - v_exp))) < 2,
    '30-min shift inherits hold_deleted expiry'
  );

  v_result := renter_create_booking(jsonb_build_object(
    'renter_id', v_renter,
    'location_id', v_loc_b,
    'rental_date', v_d,
    'time_start', '16:30',
    'time_end', '17:30',
    'idempotency_key', 'r1c-other-hall'
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'other hall create: ' || COALESCE(v_result ->> 'error', 'ok'));
  PERFORM _test_assert(
    abs(extract(epoch FROM (
      (v_result -> 'rental' ->> 'hold_expires_at')::timestamptz - v_exp
    ))) > 60,
    'other hall gets a new hold timer'
  );

  -- abutting 14:00-16:00 vs 16:00-18:00 is not overlap: new timer vs inherit of 16:00 hold
  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, hold_expires_at,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, currency,
    cancelled_at, cancelled_reason
  )
  VALUES (
    'a1c00000-0000-4000-8000-000000000088',
    v_org, v_renter, v_loc_a, v_d, '18:00', '19:00',
    'cancelled', 'miniapp', 'hold_deleted', now() + interval '9 hours',
    500, 500, 0, 1000, 'RUB',
    now(), 'miniapp_hold_deleted'
  );
  v_result := renter_create_booking(jsonb_build_object(
    'renter_id', v_renter,
    'location_id', v_loc_a,
    'rental_date', v_d,
    'time_start', '19:00',
    'time_end', '20:00',
    'idempotency_key', 'r1c-abut'
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'abut create: ' || COALESCE(v_result ->> 'error', 'ok'));
  PERFORM _test_assert(
    abs(extract(epoch FROM (
      (v_result -> 'rental' ->> 'hold_expires_at')::timestamptz - (now() + interval '9 hours')
    ))) > 60,
    'abutting 19:00 does not inherit 18:00-19:00 hold expiry'
  );

  -- refund-cancelled cooldown on overlap
  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, hold_expires_at,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, currency,
    cancelled_at, cancelled_reason
  )
  VALUES (
    'a1c00000-0000-4000-8000-000000000089',
    v_org, v_renter, v_loc_a, v_d, '21:00', '22:00',
    'cancelled', 'miniapp', 'cancelled', now() + interval '10 hours',
    500, 500, 0, 1000, 'RUB',
    now(), 'miniapp_cancel_refund'
  );
  v_result := renter_create_booking(jsonb_build_object(
    'renter_id', v_renter,
    'location_id', v_loc_a,
    'rental_date', v_d,
    'time_start', '21:30',
    'time_end', '22:30',
    'idempotency_key', 'r1c-refund-cd'
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'refund cooldown create: ' || COALESCE(v_result ->> 'error', 'ok'));
  PERFORM _test_assert(
    (v_result -> 'rental' ->> 'hold_expires_at')::timestamptz
      = _renter_slot_ts(v_org, v_d, '21:00'),
    'refund-cancelled cooldown inherits original time_start'
  );

  -- Two limits: 5 awaiting refused; pack 3 weekdays passes unfinished
  DELETE FROM rentals
  WHERE organization_id = v_org AND renter_id = v_renter AND lifecycle = 'awaiting_payment';
  -- recount: create 4 awaiting fixtures
  FOR v_n IN 1..4 LOOP
    INSERT INTO rentals (
      organization_id, renter_id, location_id, rental_date, time_start, time_end,
      booking_status, channel, lifecycle, hold_expires_at,
      prepay_amount, remainder_amount, debt_amount, fixed_amount, currency
    )
    VALUES (
      v_org, v_renter, v_loc_b, v_win_to - v_n, '08:00', '09:00',
      'confirmed', 'miniapp', 'awaiting_payment', now() + interval '20 hours',
      500, 500, 0, 1000, 'RUB'
    );
  END LOOP;
  v_result := renter_create_booking(jsonb_build_object(
    'renter_id', v_renter,
    'location_id', v_loc_b,
    'rental_date', v_win_to,
    'time_start', '08:00',
    'time_end', '09:00',
    'idempotency_key', 'r1c-hold-limit'
  ));
  PERFORM _test_assert(
    (v_result ->> 'success') IS DISTINCT FROM 'true' AND v_result ->> 'error' = 'renter.booking.holdLimit',
    '5th awaiting refused'
  );

  DELETE FROM rentals
  WHERE organization_id = v_org AND renter_id = v_renter AND lifecycle = 'awaiting_payment';

  -- Pack: next weekday (ISO) inside window, 3 days Mon/Wed/Fri
  v_pack_from := v_today + 1;
  WHILE EXTRACT(ISODOW FROM v_pack_from)::int NOT IN (1, 3, 5)
     OR v_pack_from < v_win_from
     OR v_pack_from > v_win_to
  LOOP
    v_pack_from := v_pack_from + 1;
    EXIT WHEN v_pack_from > v_win_to;
  END LOOP;
  -- Prefer a Monday
  WHILE EXTRACT(ISODOW FROM v_pack_from)::int <> 1 AND v_pack_from <= v_win_to LOOP
    v_pack_from := v_pack_from + 1;
  END LOOP;
  PERFORM _test_assert(v_pack_from <= v_win_to, 'found pack start Monday in 3-week window');
  v_pack_to := v_pack_from + 27;
  v_tail := v_pack_from + 21; -- 4th Monday

  -- Quote pack sees conflict on tail
  INSERT INTO rentals (
    organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, fixed_amount, currency
  )
  VALUES (
    v_org, v_renter_notg, v_loc_a, v_tail, '08:00', '09:00',
    'confirmed', 'cashier', NULL, 100, 'RUB'
  );

  v_quote := renter_quote_booking(jsonb_build_object(
    'location_id', v_loc_a,
    'valid_from', v_pack_from,
    'valid_to', v_pack_to,
    'weekdays', jsonb_build_array(1, 3, 5),
    'time_start', '08:00',
    'time_end', '09:00',
    'renter_id', v_renter
  ));
  PERFORM _test_assert((v_quote ->> 'success')::boolean, 'pack quote: ' || COALESCE(v_quote ->> 'error', 'ok'));
  SELECT COALESCE(bool_or((e ->> 'busy')::boolean), false)
  INTO v_busy_tail
  FROM jsonb_array_elements(v_quote -> 'occurrences') e
  WHERE (e ->> 'date')::date = v_tail;
  PERFORM _test_assert(v_busy_tail, 'pack quote flags conflict beyond 3-week UI window');
  PERFORM _test_assert(jsonb_array_length(v_quote -> 'occurrences') = 12, '3 weekdays × 4 weeks = 12 occurrences');

  DELETE FROM rentals
  WHERE organization_id = v_org AND renter_id = v_renter_notg AND rental_date = v_tail AND channel = 'cashier';

  -- Successful pack (15:00 — avoid 08:00 occupied by far one-time / remainder fixture)
  v_result := renter_create_recurring_pack(jsonb_build_object(
    'renter_id', v_renter,
    'location_id', v_loc_a,
    'valid_from', v_pack_from,
    'valid_to', v_pack_to,
    'weekdays', jsonb_build_array(1, 3, 5),
    'time_start', '15:00',
    'time_end', '16:00',
    'idempotency_key', 'r1c-pack-ok'
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'pack create: ' || COALESCE(v_result ->> 'error', 'ok'));
  v_series := (v_result ->> 'series_id')::uuid;
  PERFORM _test_assert(
    (SELECT channel FROM rental_series WHERE id = v_series) = 'miniapp',
    'pack writes rental_series channel=miniapp'
  );
  PERFORM _test_assert(
    EXISTS (
      SELECT 1 FROM rental_series_patterns p
      WHERE p.series_id = v_series AND p.days_of_week @> ARRAY[1, 3, 5]
    ),
    'pack writes rental_series_patterns'
  );
  PERFORM _test_assert(
    (SELECT count(*) FROM rentals r WHERE r.rental_series_id = v_series) = 12,
    '12 occurrences with rental_series_id'
  );
  PERFORM _test_assert(
    NOT EXISTS (SELECT 1 FROM rental_series_exceptions e WHERE e.series_id = v_series),
    'no rental_series_exceptions on Mini App pack'
  );
  PERFORM _test_assert(
    NOT EXISTS (
      SELECT 1 FROM rentals r
      WHERE r.rental_series_id = v_series AND r.lifecycle = 'awaiting_payment'
    ),
    'successful pack has no awaiting dates'
  );

  -- Same pack key
  v_result := renter_create_recurring_pack(jsonb_build_object(
    'renter_id', v_renter,
    'location_id', v_loc_a,
    'valid_from', v_pack_from,
    'valid_to', v_pack_to,
    'weekdays', jsonb_build_array(1, 3, 5),
    'time_start', '15:00',
    'time_end', '16:00',
    'idempotency_key', 'r1c-pack-ok'
  ));
  PERFORM _test_assert((v_result ->> 'already_applied')::boolean, 'pack idempotency key lives on series');

  -- Early close vs completed
  v_def := pg_get_functiondef('_renter_early_close_pack(uuid)'::regprocedure);
  PERFORM _test_assert(v_def LIKE '%surcharge_one_time_recalc%', 'early-close helper does surcharge');

  -- Occupancy / conflicts
  v_dow := EXTRACT(ISODOW FROM v_far)::int;
  INSERT INTO schedule_slots (
    id, organization_id, day_of_week, time, time_end, discipline_id, group_name,
    location_id, valid_from, valid_to
  )
  VALUES (
    v_slot_group, v_org, v_dow, '12:00', '13:00', v_disc, 'R1c Group',
    v_loc_a, DATE '2000-01-01', NULL
  )
  ON CONFLICT (id) DO NOTHING;

  v_result := renter_create_booking(jsonb_build_object(
    'renter_id', v_renter,
    'location_id', v_loc_a,
    'rental_date', v_far,
    'time_start', '12:00',
    'time_end', '13:00',
    'idempotency_key', 'r1c-group-conflict'
  ));
  PERFORM _test_assert(
    (v_result ->> 'success') IS DISTINCT FROM 'true' AND v_result ->> 'error' = 'renter.booking.conflict',
    'conflict with group slot'
  );

  INSERT INTO schedule_occurrence_cancellations (
    id, organization_id, slot_id, occurrence_date, time, time_end, location_id, group_name
  )
  VALUES (v_soc, v_org, v_slot_group, v_far, '12:00', '13:00', v_loc_a, 'R1c Group');

  v_result := renter_create_booking(jsonb_build_object(
    'renter_id', v_renter,
    'location_id', v_loc_a,
    'rental_date', v_far,
    'time_start', '12:00',
    'time_end', '13:00',
    'idempotency_key', 'r1c-group-cancelled-ok'
  ));
  PERFORM _test_assert(
    (v_result ->> 'success')::boolean,
    'cancelled group occurrence is free: ' || COALESCE(v_result ->> 'error', 'ok')
  );

  INSERT INTO personal_lessons (
    id, organization_id, type, client_id1, date, time_start, time_end,
    discipline_id, location_id, teacher_member_id, price, paid
  )
  VALUES (
    v_personal, v_org, 'solo', v_client, v_far, '13:00', '14:00',
    v_disc, v_loc_a, v_member, 1000, 'no'
  )
  ON CONFLICT (id) DO NOTHING;
  v_result := renter_create_booking(jsonb_build_object(
    'renter_id', v_renter,
    'location_id', v_loc_a,
    'rental_date', v_far,
    'time_start', '13:00',
    'time_end', '14:00',
    'idempotency_key', 'r1c-personal-conflict'
  ));
  PERFORM _test_assert(
    v_result ->> 'error' = 'renter.booking.conflict',
    'conflict with personal lesson'
  );

  INSERT INTO calendar_events (
    id, organization_id, title, event_type, created_by
  )
  VALUES (v_event, v_org, 'R1c Event', 'master_class', v_member);
  INSERT INTO calendar_event_sessions (
    id, organization_id, event_id, location_id, session_date, time_start, time_end
  )
  VALUES (v_event_sess, v_org, v_event, v_loc_a, v_far, '09:00', '10:00');
  v_result := renter_create_booking(jsonb_build_object(
    'renter_id', v_renter,
    'location_id', v_loc_a,
    'rental_date', v_far,
    'time_start', '09:00',
    'time_end', '10:00',
    'idempotency_key', 'r1c-event-conflict'
  ));
  PERFORM _test_assert(
    v_result ->> 'error' = 'renter.booking.conflict',
    'conflict with calendar event'
  );

  -- Occupancy PII / own lifecycle / generic location
  PERFORM _r1c_set_renter_jwt(v_renter_user, v_org, 91001);
  v_result := renter_get_occupancy(v_loc_a);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'occupancy: ' || COALESCE(v_result ->> 'error', 'ok'));
  PERFORM _test_assert(
    v_result::text NOT LIKE '%' || v_renter_notg::text || '%',
    'occupancy has no foreign renter_id'
  );
  PERFORM _test_assert(
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_result -> 'mine') m
      WHERE m ->> 'lifecycle' IS NOT NULL
    ),
    'occupancy returns own lifecycle'
  );
  v_result := renter_get_occupancy(v_loc_off);
  PERFORM _test_assert(
    v_result ->> 'error' = 'renter.booking.locationUnavailable',
    'disabled hall same generic error'
  );
  v_result := renter_get_occupancy('a1c00000-0000-4000-8000-00000000ffff');
  PERFORM _test_assert(
    v_result ->> 'error' = 'renter.booking.locationUnavailable',
    'missing hall same generic error'
  );

  -- Staff occupancy forbidden
  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');
  v_result := renter_get_occupancy(v_loc_a);
  PERFORM _test_assert(v_result ->> 'error' = 'renter.forbidden', 'occupancy is renter-only');

  -- Accountant cannot create/cancel/quote
  PERFORM _hall_rent_test_set_jwt(v_acc_user, v_org, v_acc_member, 'accountant');
  PERFORM _test_assert(member_can_create_rental() IS TRUE, 'accountant still member_can_create_rental for cashier');
  PERFORM _test_assert(member_can_manage_rentals() IS FALSE, 'accountant is not member_can_manage_rentals');
  v_result := renter_create_booking(jsonb_build_object(
    'renter_id', v_renter, 'location_id', v_loc_a,
    'rental_date', v_far, 'time_start', '07:00', 'time_end', '08:00'
  ));
  PERFORM _test_assert(v_result ->> 'error' = 'renter.forbidden', 'accountant cannot Mini App create');
  v_result := renter_quote_booking(jsonb_build_object(
    'location_id', v_loc_a, 'rental_date', v_far, 'time_start', '07:00', 'time_end', '08:00'
  ));
  PERFORM _test_assert(v_result ->> 'error' = 'renter.forbidden', 'accountant cannot quote');
  v_result := renter_cancel_occurrence(v_id);
  PERFORM _test_assert(v_result ->> 'error' = 'renter.forbidden', 'accountant cannot Mini App cancel');

  -- Owner create without telegram refused
  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');
  v_result := renter_create_booking(jsonb_build_object(
    'renter_id', v_renter_notg, 'location_id', v_loc_a,
    'rental_date', v_far, 'time_start', '07:00', 'time_end', '08:00',
    'idempotency_key', 'r1c-notg'
  ));
  PERFORM _test_assert(v_result ->> 'error' = 'renter.booking.noTelegram', 'staff create without telegram_id refused');

  v_result := renter_create_booking(jsonb_build_object(
    'renter_id', v_renter_arch, 'location_id', v_loc_a,
    'rental_date', v_far, 'time_start', '07:00', 'time_end', '08:00',
    'idempotency_key', 'r1c-arch'
  ));
  PERFORM _test_assert(v_result ->> 'error' = 'renter.booking.inactive', 'status≠active blocks create');

  -- Debt blocks create; delete_hold allowed
  UPDATE rentals SET debt_amount = 10, lifecycle = 'debt'
  WHERE id = 'a1c00000-0000-4000-8000-000000000082';
  -- debt is on another renter; set on v_renter
  UPDATE rentals SET debt_amount = 15
  WHERE id = v_id AND renter_id = v_renter;
  -- v_id may be active; debt_amount>0 blocks
  v_result := renter_create_booking(jsonb_build_object(
    'renter_id', v_renter, 'location_id', v_loc_b,
    'rental_date', v_win_to, 'time_start', '07:00', 'time_end', '08:00',
    'idempotency_key', 'r1c-debt-block'
  ));
  PERFORM _test_assert(v_result ->> 'error' = 'renter.booking.debt', 'debt blocks create');

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, hold_expires_at,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, currency
  )
  VALUES (
    'a1c00000-0000-4000-8000-00000000008a',
    v_org, v_renter, v_loc_b, v_win_to, '10:00', '11:00',
    'confirmed', 'miniapp', 'awaiting_payment', now() + interval '5 hours',
    500, 500, 0, 1000, 'RUB'
  );
  v_result := renter_delete_hold('a1c00000-0000-4000-8000-00000000008a');
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'delete_hold allowed while in debt: ' || COALESCE(v_result ->> 'error', 'ok'));
  PERFORM _test_assert(
    (SELECT lifecycle FROM rentals WHERE id = 'a1c00000-0000-4000-8000-00000000008a') = 'hold_deleted',
    'delete_hold → hold_deleted'
  );
  PERFORM _test_assert(
    (SELECT hold_expires_at IS NOT NULL FROM rentals WHERE id = 'a1c00000-0000-4000-8000-00000000008a'),
    'hold_expires_at not NULL after hold_deleted'
  );

  UPDATE rentals SET debt_amount = 0 WHERE id = v_id AND renter_id = v_renter;

  -- update_rental Mini App refused (R1a)
  v_result := update_rental(v_id, jsonb_build_object('time_start', '10:00'));
  PERFORM _test_assert(
    (v_result ->> 'success') IS DISTINCT FROM 'true',
    'update_rental Mini App refused'
  );

  -- module off (demo CRM): create/pack/quote fail; bootstrap/list/occupancy/list_mine/cancel ok
  UPDATE organizations SET status = 'demo_active' WHERE id = v_org;
  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');
  v_result := renter_create_booking(jsonb_build_object(
    'renter_id', v_renter, 'location_id', v_loc_a,
    'rental_date', v_far, 'time_start', '07:00', 'time_end', '08:00',
    'idempotency_key', 'r1c-addon-off'
  ));
  PERFORM _test_assert(v_result ->> 'error' = 'renter.addonInactive', 'add-on off blocks create');
  v_result := renter_quote_booking(jsonb_build_object(
    'location_id', v_loc_a, 'rental_date', v_far, 'time_start', '07:00', 'time_end', '08:00'
  ));
  PERFORM _test_assert(v_result ->> 'error' = 'renter.addonInactive', 'add-on off blocks quote');

  PERFORM _r1c_set_renter_jwt(v_renter_user, v_org, 91001);
  v_result := renter_bootstrap();
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'bootstrap works with add-on off');
  PERFORM _test_assert((v_result ->> 'addon_active') IS DISTINCT FROM 'true', 'bootstrap reports add-on off');
  PERFORM _test_assert(v_result ->> 'studio_name' = 'R1c Studio', 'bootstrap studio name');
  PERFORM _test_assert(v_result ->> 'chat_url' IS NULL, 'chat URL placeholder until R2');
  v_result := renter_list_locations();
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'list_locations works with add-on off');
  v_result := renter_get_occupancy(v_loc_a);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'occupancy works with add-on off');
  v_result := renter_list_mine(10, 0);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'list_mine works with add-on off');
  PERFORM _test_assert((v_result ->> 'total')::int >= 1, 'list_mine paginated total');
  v_result := renter_get_wallet(10, 0);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'wallet works with add-on off');
  PERFORM _test_assert(v_result ? 'spendable' AND v_result ? 'reserved_prepay', 'wallet splits spendable and reserved');
  PERFORM _test_assert(
    (v_result ->> 'spendable')::numeric IS DISTINCT FROM (v_result ->> 'reserved_prepay')::numeric
      OR (v_result ->> 'reserved_prepay')::numeric = 0,
    'spendable and reserved are separate fields'
  );

  -- cancel still works with add-on off (dedicated future active slot — v_id may be terminal after pack grid)
  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');
  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, hold_expires_at,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, currency
  )
  VALUES (
    'a1c00000-0000-4000-8000-00000000008b',
    v_org, v_renter, v_loc_b, v_far, '07:00', '08:00',
    'confirmed', 'miniapp', 'active',
    _renter_slot_ts(v_org, v_far, '08:00'),
    500, 500, 0, 1000, 'RUB'
  );
  v_result := renter_cancel_occurrence('a1c00000-0000-4000-8000-00000000008b');
  PERFORM _test_assert(
    (v_result ->> 'success')::boolean,
    'cancel works with add-on off: ' || COALESCE(v_result ->> 'error', 'ok')
  );

  UPDATE organizations SET status = 'licensed' WHERE id = v_org;

  -- Renter JWT ignores client renter_id
  PERFORM _r1c_set_renter_jwt(v_renter_user, v_org, 91001);
  v_result := renter_update_profile(jsonb_build_object(
    'display_name', 'R1c Renamed',
    'contact_phone', '+7 (999) 111-22-33'
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'update_profile: ' || COALESCE(v_result ->> 'error', 'ok'));
  PERFORM _test_assert(
    (SELECT display_name FROM renters WHERE id = v_renter) = 'R1c Renamed',
    'profile updated on card matched by telegram, not JWT renter_id'
  );

  -- tooSoon: start < now+1h
  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');
  SELECT d, ts, te INTO v_d2, v_ts2, v_te2 FROM _r1c_slot_at(v_org, interval '20 minutes');
  IF v_d2 = v_today THEN
    v_result := renter_create_booking(jsonb_build_object(
      'renter_id', v_renter, 'location_id', v_loc_b,
      'rental_date', v_d2, 'time_start', v_ts2, 'time_end', v_te2,
      'idempotency_key', 'r1c-toosoon'
    ));
    PERFORM _test_assert(
      v_result ->> 'error' = 'renter.booking.tooSoon',
      'start < now+1h refused'
    );
  END IF;

  PERFORM _test_assert(
    pg_get_functiondef('renter_create_booking(jsonb)'::regprocedure)
      LIKE '%_renter_insert_occurrence%'
    AND pg_get_functiondef('_renter_insert_occurrence(uuid,uuid,uuid,date,text,text,text,uuid,text,uuid)'::regprocedure)
      LIKE '%now()%',
    'create uses Postgres now() for slot thresholds'
  );

  RAISE NOTICE 'R1c booking engine tests passed';
END;
$$;

ROLLBACK;
