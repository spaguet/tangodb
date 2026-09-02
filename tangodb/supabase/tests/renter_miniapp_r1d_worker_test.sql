-- R1d: worker expiry/catch-up, staff hour-rate RPC, telegram_id, schedule payload.
-- Run: psql "%DATABASE_URL%" -v ON_ERROR_STOP=1 -f supabase/tests/_hall_rent_test_jwt.sql -f supabase/tests/renter_miniapp_r1d_worker_test.sql

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

CREATE OR REPLACE FUNCTION _r1d_set_renter_jwt(p_user uuid, p_org uuid, p_telegram bigint)
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

CREATE OR REPLACE FUNCTION _r1d_purge_renter(p_renter uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM renter_reliability_events WHERE renter_id = p_renter;
  DELETE FROM renter_wallet_ledger WHERE renter_id = p_renter;
  DELETE FROM rentals WHERE renter_id = p_renter;
  DELETE FROM rental_series WHERE renter_id = p_renter;
  UPDATE renters
  SET
    on_time_count = 0,
    untimely_count = 0,
    booking_banned_at = NULL,
    penalty_tariff_applied_at = NULL
  WHERE id = p_renter;
END;
$$;

CREATE OR REPLACE FUNCTION _r1d_insert_slot(
  p_org uuid,
  p_renter uuid,
  p_loc uuid,
  p_date date,
  p_ts text,
  p_te text,
  p_life text,
  p_hold timestamptz,
  p_series uuid DEFAULT NULL,
  p_prepay numeric DEFAULT 500,
  p_remainder numeric DEFAULT 500,
  p_prepay_at timestamptz DEFAULT NULL,
  p_remainder_at timestamptz DEFAULT NULL,
  p_debt numeric DEFAULT 0
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO rentals (
    organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, hold_expires_at, rental_series_id,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, calculated_amount,
    currency, prepay_charged_at, remainder_charged_at
  )
  VALUES (
    p_org, p_renter, p_loc, p_date, p_ts, p_te,
    'confirmed', 'miniapp', p_life, p_hold, p_series,
    p_prepay, p_remainder, p_debt, p_prepay + p_remainder, p_prepay + p_remainder,
    'RUB', p_prepay_at, p_remainder_at
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

DO $$
DECLARE
  v_version_id uuid;
  v_org uuid := 'a1d00000-0000-4000-8000-000000000001';
  v_user uuid := 'a1d00000-0000-4000-8000-000000000011';
  v_acc_user uuid := 'a1d00000-0000-4000-8000-000000000012';
  v_teacher_user uuid := 'a1d00000-0000-4000-8000-000000000014';
  v_renter_user uuid := 'a1d00000-0000-4000-8000-000000000013';
  v_member uuid := 'a1d00000-0000-4000-8000-000000000021';
  v_acc_member uuid := 'a1d00000-0000-4000-8000-000000000022';
  v_teacher_member uuid := 'a1d00000-0000-4000-8000-000000000024';
  v_loc uuid := 'a1d00000-0000-4000-8000-0000000000aa';
  v_renter uuid := 'a1d00000-0000-4000-8000-000000000041';
  v_renter2 uuid := 'a1d00000-0000-4000-8000-000000000042';
  v_renter_idle uuid := 'a1d00000-0000-4000-8000-000000000043';
  v_renter_pack uuid := 'a1d00000-0000-4000-8000-000000000044';
  v_renter_close uuid := 'a1d00000-0000-4000-8000-000000000045';
  v_tz text;
  v_now_local timestamp;
  v_d date;
  v_ts text;
  v_te text;
  v_h int;
  v_m int;
  v_id uuid;
  v_id2 uuid;
  v_series uuid;
  v_used uuid;
  v_life text;
  v_hold timestamptz;
  v_start timestamptz;
  v_result jsonb;
  v_week jsonb;
  v_row jsonb;
  v_n int;
  v_untimely int;
  v_debt numeric;
  v_status text;
  v_surcharge int;
  v_ahead timestamp;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES
    (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'r1d-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_acc_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'r1d-acc@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_teacher_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'r1d-teacher@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_renter_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'r1d-renter@users.invalid', crypt('testpass123', gen_salt('bf')), now(), now(), now(),
     jsonb_build_object('actor', 'renter', 'organization_id', v_org::text, 'telegram_id', '92001'),
     '{}'::jsonb)
  ON CONFLICT (id) DO UPDATE SET raw_app_meta_data = EXCLUDED.raw_app_meta_data;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'R1d Worker Org', 'r1d-worker', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed', owner_user_id = EXCLUDED.owner_user_id;

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET license_type = 'lifetime', activated_at = now();

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES
    (v_member, v_org, v_user, 'owner', 'R1d Owner'),
    (v_acc_member, v_org, v_acc_user, 'accountant', 'R1d Acc'),
    (v_teacher_member, v_org, v_teacher_user, 'teacher', 'R1d Teacher')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, currency_code, locale, branding_name)
  VALUES (v_org, 'Europe/Moscow', 'RUB', 'ru', 'R1d Studio')
  ON CONFLICT (organization_id) DO UPDATE SET
    timezone = EXCLUDED.timezone,
    currency_code = EXCLUDED.currency_code,
    finance_period_closed_until = NULL;

  INSERT INTO locations (id, organization_id, name, miniapp_enabled)
  VALUES (v_loc, v_org, 'Hall R1d', true)
  ON CONFLICT (id) DO UPDATE SET miniapp_enabled = true;

  INSERT INTO renters (id, organization_id, display_name, telegram_id, status)
  VALUES
    (v_renter, v_org, 'R1d Renter', 92001, 'active'),
    (v_renter2, v_org, 'R1d Renter Two', 92002, 'active'),
    (v_renter_idle, v_org, 'R1d Idle', 92003, 'active'),
    (v_renter_pack, v_org, 'R1d Pack', 92004, 'active'),
    (v_renter_close, v_org, 'R1d Close', 92005, 'active')
  ON CONFLICT (id) DO UPDATE SET telegram_id = EXCLUDED.telegram_id, status = 'active';

  INSERT INTO organization_addons (organization_id, addon_code, status, period_start, period_end)
  VALUES (v_org, 'renter_miniapp', 'active', CURRENT_DATE - 1, CURRENT_DATE + 365)
  ON CONFLICT (organization_id, addon_code) DO UPDATE SET
    status = 'active', period_start = EXCLUDED.period_start, period_end = EXCLUDED.period_end;

  INSERT INTO location_rental_hour_rates (organization_id, location_id, kind, price, currency, valid_from)
  VALUES
    (v_org, v_loc, 'one_time', 1000, 'RUB', DATE '2000-01-01'),
    (v_org, v_loc, 'recurring', 800, 'RUB', DATE '2000-01-01'),
    (v_org, v_loc, 'penalty', 1500, 'RUB', DATE '2000-01-01');

  v_tz := _org_timezone(v_org);

  -- ---------------------------------------------------------------------------
  -- Helpers / grants / indexes
  -- ---------------------------------------------------------------------------
  PERFORM _test_assert(
    EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_rentals_miniapp_time_end'),
    'partial index on miniapp time_end'
  );
  PERFORM _test_assert(
    pg_get_functiondef('run_renter_booking_maintenance(integer)'::regprocedure)
      LIKE '%_renter_expire_and_catchup%',
    'worker RPC calls R1c expire/catchup'
  );
  PERFORM _test_assert(
    pg_get_functiondef('_renter_expire_and_catchup(uuid,uuid)'::regprocedure)
      LIKE '%_renter_reliability_tick_allowed%'
    AND pg_get_functiondef('_renter_expire_and_catchup(uuid,uuid)'::regprocedure)
      LIKE '%_renter_apply_reliability%',
    'expire passes reliability allow-flag into the same apply_reliability name'
  );
  PERFORM _test_assert(
    pg_get_functiondef('_renter_apply_reliability(uuid,text,boolean)'::regprocedure)
      LIKE '%renter_reliability_events%',
    'apply_reliability is R5 implementation (not R1d stub)'
  );
  PERFORM _test_assert(
    pg_get_functiondef('_renter_drain_telegram_outbox()'::regprocedure)
      NOT LIKE '%sendMessage%',
    'drain stub has no Bot API'
  );
  PERFORM _test_assert(
    _renter_compute_hold_expires_at(now(), now() + interval '1 hour')
      = now() + interval '1 hour',
    'hold expiry is min(created+24h, time_start)'
  );
  PERFORM _test_assert(
    NOT has_table_privilege('authenticated', 'location_rental_hour_rates', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'location_rental_hour_rates', 'INSERT')
    AND NOT has_table_privilege('anon', 'location_rental_hour_rates', 'SELECT'),
    'hour rates table has no JWT GRANT SELECT/INSERT'
  );
  PERFORM _test_assert(
    NOT has_function_privilege('authenticated', 'run_renter_booking_maintenance(integer)', 'EXECUTE')
    AND has_function_privilege('service_role', 'run_renter_booking_maintenance(integer)', 'EXECUTE'),
    'maintenance RPC is service_role only'
  );

  -- ---------------------------------------------------------------------------
  -- Expiry min(hold, time_start): hold already past, start in the future
  -- ---------------------------------------------------------------------------
  PERFORM _r1d_purge_renter(v_renter);
  v_id := _r1d_insert_slot(
    v_org, v_renter, v_loc,
    (now() AT TIME ZONE v_tz)::date + 2, '18:00', '19:00',
    'awaiting_payment', now() - interval '2 minutes'
  );
  v_result := run_renter_booking_maintenance(20);
  PERFORM _test_assert((v_result ->> 'processed')::int >= 1, 'worker processed expired hold');
  SELECT lifecycle INTO v_life FROM rentals WHERE id = v_id;
  PERFORM _test_assert(v_life = 'auto_deleted', 'expired hold → auto_deleted');
  SELECT untimely_count INTO v_untimely FROM renters WHERE id = v_renter;
  PERFORM _test_assert(v_untimely = 1, 'untimely++ on hold expiry when add-on active');

  -- ---------------------------------------------------------------------------
  -- Awaiting past start even if hold_expires_at is later
  -- ---------------------------------------------------------------------------
  PERFORM _r1d_purge_renter(v_renter);
  v_id := _r1d_insert_slot(
    v_org, v_renter, v_loc,
    (now() AT TIME ZONE v_tz)::date - 1, '12:00', '13:00',
    'awaiting_payment', now() + interval '2 days'
  );
  PERFORM _renter_expire_and_catchup(v_org, v_renter);
  SELECT lifecycle INTO v_life FROM rentals WHERE id = v_id;
  PERFORM _test_assert(v_life = 'auto_deleted', 'awaiting past start → auto_deleted even if hold later');

  -- ---------------------------------------------------------------------------
  -- T−24 charge fail → awaiting with new timer, not auto_deleted
  -- ---------------------------------------------------------------------------
  PERFORM _r1d_purge_renter(v_renter);
  v_ahead := date_trunc('hour', (now() AT TIME ZONE v_tz) + interval '12 hours');
  IF EXTRACT(HOUR FROM v_ahead) >= 23 THEN
    v_ahead := date_trunc('day', v_ahead) + interval '1 day' + interval '10 hours';
  END IF;
  v_d := v_ahead::date;
  v_ts := to_char(v_ahead, 'HH24:MI');
  v_te := to_char(v_ahead + interval '1 hour', 'HH24:MI');
  v_start := _renter_slot_ts(v_org, v_d, v_ts);
  IF v_start - interval '24 hours' <= now() AND now() < v_start THEN
    v_id := _r1d_insert_slot(
      v_org, v_renter, v_loc, v_d, v_ts, v_te,
      'active', NULL
    );
    PERFORM _renter_expire_and_catchup(v_org, v_renter);
    SELECT lifecycle, hold_expires_at INTO v_life, v_hold FROM rentals WHERE id = v_id;
    PERFORM _test_assert(v_life = 'awaiting_payment', 'T-24 fail → awaiting, not auto_deleted');
    PERFORM _test_assert(
      v_hold IS NOT NULL AND v_hold <= v_start AND v_hold > now() - interval '2 seconds',
      'T-24 fail sets a new hold timer min(now+24h, start)'
    );
    SELECT untimely_count INTO v_untimely FROM renters WHERE id = v_renter;
    PERFORM _test_assert(v_untimely = 0, 'untimely++ stays 0 on T-24 fail');
  ELSE
    RAISE NOTICE 'R1d skip T-24 window fixture at local %', v_ahead;
  END IF;

  -- ---------------------------------------------------------------------------
  -- Catch-up p.3: active, time_start ≤ now < time_end, no money → auto_deleted
  -- ---------------------------------------------------------------------------
  PERFORM _r1d_purge_renter(v_renter);
  v_now_local := now() AT TIME ZONE v_tz;
  v_d := v_now_local::date;
  v_h := EXTRACT(HOUR FROM v_now_local)::int;
  v_m := EXTRACT(MINUTE FROM v_now_local)::int;
  IF v_h < 23 OR (v_h = 23 AND v_m < 50) THEN
    v_ts := lpad(v_h::text, 2, '0') || ':00';
    v_te := CASE WHEN v_h < 22 THEN lpad((v_h + 1)::text, 2, '0') || ':00' ELSE '23:59' END;
    IF _renter_slot_ts(v_org, v_d, v_ts) <= now()
       AND now() < _renter_slot_ts(v_org, v_d, v_te) THEN
      v_id := _r1d_insert_slot(
        v_org, v_renter, v_loc, v_d, v_ts, v_te,
        'active', NULL
      );
      PERFORM _renter_expire_and_catchup(v_org, v_renter);
      SELECT lifecycle INTO v_life FROM rentals WHERE id = v_id;
      PERFORM _test_assert(v_life = 'auto_deleted', 'catch-up in-progress without money → auto_deleted');
      SELECT untimely_count INTO v_untimely FROM renters WHERE id = v_renter;
      PERFORM _test_assert(v_untimely = 1, 'untimely++ on catch-up auto_deleted when allowed');
    END IF;
  END IF;

  -- ---------------------------------------------------------------------------
  -- Catch-up p.3 with balance → prepaid_charged (not auto_deleted)
  -- ---------------------------------------------------------------------------
  PERFORM _r1d_purge_renter(v_renter);
  IF v_h < 23 OR (v_h = 23 AND v_m < 50) THEN
    IF _renter_slot_ts(v_org, v_d, v_ts) <= now()
       AND now() < _renter_slot_ts(v_org, v_d, v_te) THEN
      INSERT INTO renter_wallet_ledger (organization_id, renter_id, entry_type, amount)
      VALUES (v_org, v_renter, 'topup', 20000);
      v_id := _r1d_insert_slot(
        v_org, v_renter, v_loc, v_d, v_ts, v_te,
        'active', NULL
      );
      PERFORM _renter_expire_and_catchup(v_org, v_renter);
      SELECT lifecycle INTO v_life FROM rentals WHERE id = v_id;
      PERFORM _test_assert(v_life = 'prepaid_charged', 'catch-up with money → prepaid_charged');
    END IF;
  END IF;

  -- ---------------------------------------------------------------------------
  -- Catch-up p.2: active after time_end, no money → debt, not auto_deleted
  -- ---------------------------------------------------------------------------
  PERFORM _r1d_purge_renter(v_renter);
  v_id := _r1d_insert_slot(
    v_org, v_renter, v_loc,
    (now() AT TIME ZONE v_tz)::date - 1, '12:00', '13:00',
    'active', NULL
  );
  PERFORM _renter_expire_and_catchup(v_org, v_renter);
  SELECT lifecycle INTO v_life FROM rentals WHERE id = v_id;
  PERFORM _test_assert(v_life = 'debt', 'active after time_end without money → debt');
  PERFORM _test_assert(v_life IS DISTINCT FROM 'auto_deleted', 'p.2 never auto_deleted');

  -- ---------------------------------------------------------------------------
  -- Catch-up p.2 with money covering full cost → settled
  -- ---------------------------------------------------------------------------
  PERFORM _r1d_purge_renter(v_renter);
  INSERT INTO renter_wallet_ledger (organization_id, renter_id, entry_type, amount)
  VALUES (v_org, v_renter, 'topup', 20000);
  v_id := _r1d_insert_slot(
    v_org, v_renter, v_loc,
    (now() AT TIME ZONE v_tz)::date - 1, '14:00', '15:00',
    'active', NULL
  );
  PERFORM _renter_expire_and_catchup(v_org, v_renter);
  SELECT lifecycle INTO v_life FROM rentals WHERE id = v_id;
  PERFORM _test_assert(v_life = 'settled', 'active after time_end with money → settled');

  -- ---------------------------------------------------------------------------
  -- Last used pack → series.completed without surcharge
  -- ---------------------------------------------------------------------------
  PERFORM _r1d_purge_renter(v_renter_pack);
  INSERT INTO rental_series (
    organization_id, renter_id, location_id, tariff_id, valid_from, valid_to, status, channel
  )
  VALUES (
    v_org, v_renter_pack, v_loc, NULL,
    CURRENT_DATE - 20, CURRENT_DATE - 1, 'active', 'miniapp'
  )
  RETURNING id INTO v_series;
  v_id := _r1d_insert_slot(
    v_org, v_renter_pack, v_loc,
    (now() AT TIME ZONE v_tz)::date - 3, '12:00', '13:00',
    'prepaid_charged', NULL, v_series, 400, 400, now() - interval '3 days', NULL
  );
  v_id2 := _r1d_insert_slot(
    v_org, v_renter_pack, v_loc,
    (now() AT TIME ZONE v_tz)::date - 1, '12:00', '13:00',
    'prepaid_charged', NULL, v_series, 400, 400, now() - interval '1 day', NULL
  );
  PERFORM _renter_expire_and_catchup(v_org, v_renter_pack);
  SELECT status INTO v_status FROM rental_series WHERE id = v_series;
  PERFORM _test_assert(v_status = 'completed', 'last used pack → series.completed');
  SELECT count(*) INTO v_surcharge
  FROM renter_wallet_ledger
  WHERE renter_id = v_renter_pack AND entry_type = 'surcharge_one_time_recalc';
  PERFORM _test_assert(v_surcharge = 0, 'completed pack has no early-close surcharge');
  SELECT lifecycle INTO v_life FROM rentals WHERE id = v_id2;
  PERFORM _test_assert(v_life IN ('settled', 'debt'), 'used pack dates are settled or debt');

  -- ---------------------------------------------------------------------------
  -- Last future auto_deleted → early-close + surcharge, not completed
  -- ---------------------------------------------------------------------------
  PERFORM _r1d_purge_renter(v_renter_close);
  INSERT INTO rental_series (
    organization_id, renter_id, location_id, tariff_id, valid_from, valid_to, status, channel
  )
  VALUES (
    v_org, v_renter_close, v_loc, NULL,
    CURRENT_DATE - 10, CURRENT_DATE + 20, 'active', 'miniapp'
  )
  RETURNING id INTO v_series;
  v_used := _r1d_insert_slot(
    v_org, v_renter_close, v_loc,
    (now() AT TIME ZONE v_tz)::date - 2, '12:00', '13:00',
    'settled', NULL, v_series, 400, 400, now() - interval '2 days', now() - interval '2 days'
  );
  v_id := _r1d_insert_slot(
    v_org, v_renter_close, v_loc,
    (now() AT TIME ZONE v_tz)::date + 3, '12:00', '13:00',
    'awaiting_payment', now() - interval '1 minute', v_series
  );
  v_result := run_renter_booking_maintenance(20);
  PERFORM _test_assert((v_result ->> 'processed')::int >= 1, 'worker processed last future pack date');
  SELECT lifecycle INTO v_life FROM rentals WHERE id = v_id;
  PERFORM _test_assert(v_life = 'auto_deleted', 'last future pack date auto_deleted');
  SELECT status INTO v_status FROM rental_series WHERE id = v_series;
  PERFORM _test_assert(v_status = 'cancelled', 'early-close cancels series, not completed');
  PERFORM _test_assert(v_status IS DISTINCT FROM 'completed', 'auto_deleted last future is not completed');
  SELECT debt_amount INTO v_debt FROM rentals WHERE id = v_used;
  SELECT count(*) INTO v_surcharge
  FROM renter_wallet_ledger
  WHERE renter_id = v_renter_close AND entry_type = 'surcharge_one_time_recalc';
  PERFORM _test_assert(
    v_debt > 0 OR v_surcharge > 0,
    'early-close applies one_time surcharge (debt or ledger)'
  );

  -- ---------------------------------------------------------------------------
  -- allows_writes=false does not stop expiry
  -- ---------------------------------------------------------------------------
  PERFORM _r1d_purge_renter(v_renter);
  UPDATE organizations SET status = 'suspended' WHERE id = v_org;
  v_id := _r1d_insert_slot(
    v_org, v_renter, v_loc,
    (now() AT TIME ZONE v_tz)::date + 1, '18:00', '19:00',
    'awaiting_payment', now() - interval '1 minute'
  );
  PERFORM _renter_expire_and_catchup(v_org, v_renter);
  SELECT lifecycle INTO v_life FROM rentals WHERE id = v_id;
  PERFORM _test_assert(v_life = 'auto_deleted', 'writes=false still expires holds');
  SELECT untimely_count INTO v_untimely FROM renters WHERE id = v_renter;
  PERFORM _test_assert(v_untimely = 0, 'writes=false does not increment untimely');
  UPDATE organizations SET status = 'licensed' WHERE id = v_org;

  -- ---------------------------------------------------------------------------
  -- add-on off (demo CRM) does not stop expiry
  -- ---------------------------------------------------------------------------
  PERFORM _r1d_purge_renter(v_renter);
  UPDATE organizations SET status = 'demo_active' WHERE id = v_org;
  v_id := _r1d_insert_slot(
    v_org, v_renter, v_loc,
    (now() AT TIME ZONE v_tz)::date + 1, '18:00', '19:00',
    'awaiting_payment', now() - interval '1 minute'
  );
  PERFORM _renter_expire_and_catchup(v_org, v_renter);
  SELECT lifecycle INTO v_life FROM rentals WHERE id = v_id;
  PERFORM _test_assert(v_life = 'auto_deleted', 'add-on off still expires holds');
  SELECT untimely_count INTO v_untimely FROM renters WHERE id = v_renter;
  PERFORM _test_assert(v_untimely = 0, 'add-on off does not increment untimely');
  UPDATE organizations SET status = 'licensed' WHERE id = v_org;

  -- ---------------------------------------------------------------------------
  -- finance period closed still expires
  -- ---------------------------------------------------------------------------
  PERFORM _r1d_purge_renter(v_renter);
  UPDATE organization_settings
  SET finance_period_closed_until = _org_local_date(v_org)
  WHERE organization_id = v_org;
  v_id := _r1d_insert_slot(
    v_org, v_renter, v_loc,
    (now() AT TIME ZONE v_tz)::date + 1, '18:00', '19:00',
    'awaiting_payment', now() - interval '1 minute'
  );
  PERFORM _renter_expire_and_catchup(v_org, v_renter);
  SELECT lifecycle INTO v_life FROM rentals WHERE id = v_id;
  PERFORM _test_assert(v_life = 'auto_deleted', 'closed finance period still expires holds');
  UPDATE organization_settings SET finance_period_closed_until = NULL WHERE organization_id = v_org;

  -- ---------------------------------------------------------------------------
  -- Claim is due-work only
  -- ---------------------------------------------------------------------------
  PERFORM _r1d_purge_renter(v_renter);
  PERFORM _r1d_purge_renter(v_renter_idle);
  PERFORM _r1d_insert_slot(
    v_org, v_renter_idle, v_loc,
    (now() AT TIME ZONE v_tz)::date + 10, '18:00', '19:00',
    'awaiting_payment', now() + interval '10 days'
  );
  SELECT count(*) INTO v_n
  FROM claim_renter_booking_maintenance(20) c
  WHERE c.renter_id = v_renter_idle;
  PERFORM _test_assert(v_n = 0, 'far-future awaiting is not claimed');
  v_result := run_renter_booking_maintenance(20);
  -- idle renter must not keep the loop busy
  PERFORM _test_assert(
    NOT EXISTS (
      SELECT 1 FROM rentals r
      WHERE r.id IN (
        SELECT r2.id FROM rentals r2
        WHERE r2.renter_id = v_renter_idle AND r2.lifecycle = 'auto_deleted'
      )
    ),
    'not-due idle hold stays awaiting'
  );
  SELECT lifecycle INTO v_life
  FROM rentals
  WHERE renter_id = v_renter_idle
  LIMIT 1;
  PERFORM _test_assert(v_life = 'awaiting_payment', 'idle far hold not expired');

  -- ---------------------------------------------------------------------------
  -- Renter cancel after time_start refused
  -- ---------------------------------------------------------------------------
  PERFORM _r1d_purge_renter(v_renter);
  v_now_local := now() AT TIME ZONE v_tz;
  v_d := v_now_local::date;
  v_h := EXTRACT(HOUR FROM v_now_local)::int;
  v_m := EXTRACT(MINUTE FROM v_now_local)::int;
  IF v_h < 23 OR (v_h = 23 AND v_m < 50) THEN
    v_ts := lpad(v_h::text, 2, '0') || ':00';
    v_te := CASE WHEN v_h < 22 THEN lpad((v_h + 1)::text, 2, '0') || ':00' ELSE '23:59' END;
    IF _renter_slot_ts(v_org, v_d, v_ts) <= now()
       AND now() < _renter_slot_ts(v_org, v_d, v_te) THEN
      INSERT INTO renter_wallet_ledger (organization_id, renter_id, entry_type, amount)
      VALUES (v_org, v_renter, 'topup', 20000);
      v_id := _r1d_insert_slot(
        v_org, v_renter, v_loc, v_d, v_ts, v_te,
        'prepaid_charged', NULL, NULL, 500, 500, now()
      );
      PERFORM _r1d_set_renter_jwt(v_renter_user, v_org, 92001);
      v_result := renter_cancel_occurrence(v_id);
      PERFORM _test_assert(
        (v_result ->> 'success') IS DISTINCT FROM 'true'
        AND v_result ->> 'error' = 'renter.booking.alreadyStarted',
        'renter cancel after start refused: ' || COALESCE(v_result ->> 'error', 'ok')
      );
    END IF;
  END IF;

  -- ---------------------------------------------------------------------------
  -- telegram unique via upsert_renter; schedule week NULL paid for miniapp
  -- ---------------------------------------------------------------------------
  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');
  v_result := upsert_renter(jsonb_build_object(
    'renter_id', v_renter2,
    'display_name', 'R1d Renter Two',
    'telegram_id', '92001'
  ));
  PERFORM _test_assert(
    v_result ->> 'error' = 'renters.error.telegramIdTaken',
    'upsert telegram unique: ' || COALESCE(v_result ->> 'error', 'ok')
  );

  v_result := upsert_renter(jsonb_build_object(
    'renter_id', v_renter2,
    'display_name', 'R1d Renter Two',
    'telegram_id', '92099'
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'upsert telegram digit string');
  v_result := get_renter_detail(v_renter2);
  PERFORM _test_assert(
    jsonb_typeof(v_result -> 'renter' -> 'telegram_id') = 'string'
    AND v_result -> 'renter' ->> 'telegram_id' = '92099',
    'get_renter_detail telegram_id is a string'
  );

  PERFORM _r1d_purge_renter(v_renter);
  v_d := (now() AT TIME ZONE v_tz)::date;
  v_id := _r1d_insert_slot(
    v_org, v_renter, v_loc, v_d, '10:00', '11:00',
    'awaiting_payment', now() + interval '12 hours'
  );
  v_week := get_rentals_for_schedule_week(v_d, v_d);
  SELECT x FROM jsonb_array_elements(v_week) x
  WHERE x ->> 'rental_id' = v_id::text
  INTO v_row;
  PERFORM _test_assert(v_row IS NOT NULL, 'schedule week includes Mini App row');
  PERFORM _test_assert(v_row ->> 'channel' = 'miniapp', 'schedule week channel=miniapp');
  PERFORM _test_assert(v_row ->> 'lifecycle' = 'awaiting_payment', 'schedule week lifecycle');
  PERFORM _test_assert(
    v_row -> 'paid_amount' IS NULL OR v_row ->> 'paid_amount' IS NULL,
    'miniapp paid_amount is NULL'
  );
  PERFORM _test_assert(
    (v_row -> 'paid_amount') IS NULL OR jsonb_typeof(v_row -> 'paid_amount') = 'null',
    'miniapp paid_amount json null (not 0)'
  );
  PERFORM _test_assert(
    (v_row -> 'payment_status') IS NULL OR jsonb_typeof(v_row -> 'payment_status') = 'null',
    'miniapp payment_status json null'
  );

  -- ---------------------------------------------------------------------------
  -- Hour-rate / miniapp_enabled RPC
  -- ---------------------------------------------------------------------------
  v_result := list_location_rental_hour_rates();
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'owner lists hour rates');
  PERFORM _test_assert((v_result ->> 'can_write')::boolean, 'owner can write hour rates');

  v_result := upsert_location_rental_hour_rate(jsonb_build_object(
    'location_id', v_loc,
    'kind', 'one_time',
    'price', 1100
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'owner upserts hour rate via RPC');
  SELECT count(*) INTO v_n
  FROM location_rental_hour_rates
  WHERE organization_id = v_org AND location_id = v_loc AND kind = 'one_time';
  PERFORM _test_assert(v_n >= 2, 'upsert inserts a new valid_from row');

  v_result := set_location_miniapp_enabled(v_loc, true);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'owner sets miniapp_enabled via RPC');

  PERFORM _hall_rent_test_set_jwt(v_acc_user, v_org, v_acc_member, 'accountant');
  v_result := list_location_rental_hour_rates();
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'accountant can list hour rates');
  v_result := upsert_location_rental_hour_rate(jsonb_build_object(
    'location_id', v_loc, 'kind', 'penalty', 'price', 1600
  ));
  PERFORM _test_assert(
    (v_result ->> 'success') IS DISTINCT FROM 'true',
    'accountant cannot upsert hour rates'
  );
  v_result := set_location_miniapp_enabled(v_loc, false);
  PERFORM _test_assert(
    (v_result ->> 'success') IS DISTINCT FROM 'true',
    'accountant cannot set miniapp_enabled'
  );

  PERFORM _hall_rent_test_set_jwt(v_teacher_user, v_org, v_teacher_member, 'teacher');
  v_result := list_location_rental_hour_rates();
  PERFORM _test_assert(
    (v_result ->> 'success') IS DISTINCT FROM 'true',
    'teacher cannot list hour rates'
  );

  RAISE NOTICE 'R1d worker / staff RPC tests passed';
END;
$$;

ROLLBACK;
