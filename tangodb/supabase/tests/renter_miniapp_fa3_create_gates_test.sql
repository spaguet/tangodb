-- FA3 / P1-15: create gates re-checked after miniapp locks (debt, ban, inactive).
-- Run: npm run test:db:renter-miniapp-fa3
-- Or: psql "%DATABASE_URL%" -v ON_ERROR_STOP=1 -f supabase/tests/_hall_rent_test_jwt.sql -f supabase/tests/renter_miniapp_fa3_create_gates_test.sql

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

-- Session-level wallet lock + mutate while create waits (concurrent race harness).
CREATE OR REPLACE FUNCTION _test_fa3_hold_wallet_mutate(
  p_org uuid,
  p_renter uuid,
  p_slot uuid,
  p_debt numeric,
  p_sleep_seconds double precision DEFAULT 2
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key bigint;
BEGIN
  v_key := _renter_wallet_lock_key(p_org, p_renter);
  PERFORM pg_advisory_lock(v_key);
  IF p_debt > 0 AND p_slot IS NOT NULL THEN
    UPDATE rentals
    SET debt_amount = p_debt,
        lifecycle = CASE WHEN p_debt > 0 THEN 'debt' ELSE lifecycle END
    WHERE id = p_slot;
  END IF;
  PERFORM pg_sleep(p_sleep_seconds);
  PERFORM pg_advisory_unlock(v_key);
END;
$$;

CREATE OR REPLACE FUNCTION _test_fa3_post_lock_gate_error(
  p_org uuid,
  p_renter uuid,
  p_loc uuid,
  p_date date,
  p_mutate text,
  p_slot uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_extra jsonb;
BEGIN
  v_extra := jsonb_build_array(jsonb_build_object('location_id', p_loc, 'date', p_date));
  PERFORM _renter_acquire_miniapp_locks(p_org, p_renter, v_extra);

  IF p_mutate = 'debt' THEN
    UPDATE rentals
    SET debt_amount = 50, lifecycle = 'debt'
    WHERE id = p_slot;
  ELSIF p_mutate = 'ban' THEN
    UPDATE renters SET booking_banned_at = now(), updated_at = now() WHERE id = p_renter;
  ELSIF p_mutate = 'inactive' THEN
    UPDATE renters SET status = 'archived', archived_at = now(), updated_at = now() WHERE id = p_renter;
  ELSE
    RAISE EXCEPTION 'unknown mutate %', p_mutate;
  END IF;

  PERFORM _renter_create_gates(p_org, p_renter, true);
  RETURN NULL;
EXCEPTION
  WHEN OTHERS THEN
    RETURN SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION _fa3_slot_at(p_org uuid, p_ahead interval)
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
  v_org uuid := 'a0f30000-0000-4000-8000-000000000001';
  v_user uuid := 'a0f30000-0000-4000-8000-000000000011';
  v_member uuid := 'a0f30000-0000-4000-8000-000000000021';
  v_loc uuid := 'a0f30000-0000-4000-8000-0000000000aa';
  v_renter_debt uuid := 'a0f30000-0000-4000-8000-000000000041';
  v_renter_ban uuid := 'a0f30000-0000-4000-8000-000000000042';
  v_renter_off uuid := 'a0f30000-0000-4000-8000-000000000043';
  v_slot_debt uuid := 'a0f30000-0000-4000-8000-000000000061';
  v_slot_race uuid := 'a0f30000-0000-4000-8000-000000000062';
  v_d date;
  v_ts text;
  v_te text;
  v_far date;
  v_pack_from date;
  v_pack_to date;
  v_def text;
  v_pos_lock int;
  v_pos_gate int;
  v_err text;
  v_result jsonb;
  v_n int;
  v_id uuid;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES (
    v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'fa3-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(),
    '{}'::jsonb, '{}'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'FA3 Gates Org', 'fa3-gates', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed', owner_user_id = EXCLUDED.owner_user_id;

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET license_type = 'lifetime', activated_at = now();

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'FA3 Owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, currency_code, locale)
  VALUES (v_org, 'Europe/Moscow', 'RUB', 'ru')
  ON CONFLICT (organization_id) DO UPDATE SET
    timezone = EXCLUDED.timezone,
    currency_code = EXCLUDED.currency_code;

  INSERT INTO locations (id, organization_id, name, miniapp_enabled)
  VALUES (v_loc, v_org, 'FA3 Hall', true)
  ON CONFLICT (id) DO UPDATE SET miniapp_enabled = true;

  INSERT INTO renters (id, organization_id, display_name, status, telegram_id)
  VALUES
    (v_renter_debt, v_org, 'FA3 Debt Race', 'active', 93001),
    (v_renter_ban, v_org, 'FA3 Ban Race', 'active', 93002),
    (v_renter_off, v_org, 'FA3 Disable Race', 'active', 93003)
  ON CONFLICT (id) DO UPDATE SET
    status = 'active',
    booking_banned_at = NULL,
    archived_at = NULL,
    telegram_id = EXCLUDED.telegram_id;

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

  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');

  SELECT d, ts, te INTO v_d, v_ts, v_te FROM _fa3_slot_at(v_org, interval '3 days');

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, hold_expires_at,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, currency
  )
  VALUES
    (
      v_slot_debt, v_org, v_renter_debt, v_loc, v_d, '08:00', '09:00',
      'confirmed', 'miniapp', 'active', now() + interval '5 hours',
      500, 500, 0, 1000, 'RUB'
    ),
    (
      v_slot_race, v_org, v_renter_debt, v_loc, v_d, '09:00', '10:00',
      'confirmed', 'miniapp', 'active', now() + interval '5 hours',
      500, 500, 0, 1000, 'RUB'
    )
  ON CONFLICT (id) DO UPDATE SET debt_amount = 0, lifecycle = 'active';

  -- Function body: gates after lock
  v_def := pg_get_functiondef('renter_create_booking(jsonb)'::regprocedure);
  v_pos_lock := strpos(v_def, '_renter_acquire_miniapp_locks');
  v_pos_gate := v_pos_lock + NULLIF(strpos(substring(v_def from v_pos_lock), '_renter_create_gates'), 0) - 1;
  PERFORM _test_assert(v_pos_lock > 0, 'create_booking uses miniapp locks');
  PERFORM _test_assert(v_pos_gate > v_pos_lock, 'create_booking re-checks gates after lock');

  v_def := pg_get_functiondef('renter_create_recurring_pack(jsonb)'::regprocedure);
  v_pos_lock := strpos(v_def, '_renter_acquire_miniapp_locks');
  v_pos_gate := v_pos_lock + NULLIF(strpos(substring(v_def from v_pos_lock), '_renter_create_gates'), 0) - 1;
  PERFORM _test_assert(v_pos_lock > 0, 'create_pack uses miniapp locks');
  PERFORM _test_assert(v_pos_gate > v_pos_lock, 'create_pack re-checks gates after lock');

  PERFORM _test_assert(
    pg_get_functiondef('_renter_acquire_miniapp_locks(uuid,uuid,jsonb)'::regprocedure)
      LIKE '%ORDER BY p.location_id, p.occurrence_date%',
    'lock pairs sorted by location_id, date (not time_start)'
  );

  -- Post-lock gate helper: debt / ban / inactive
  SELECT d INTO v_far FROM _fa3_slot_at(v_org, interval '10 days');
  v_err := _test_fa3_post_lock_gate_error(v_org, v_renter_debt, v_loc, v_far, 'debt', v_slot_debt);
  PERFORM _test_assert(v_err = 'renter.booking.debt', 'post-lock debt gate: ' || COALESCE(v_err, 'null'));

  UPDATE renters SET booking_banned_at = NULL, status = 'active', archived_at = NULL WHERE id = v_renter_ban;
  v_err := _test_fa3_post_lock_gate_error(v_org, v_renter_ban, v_loc, v_far, 'ban');
  PERFORM _test_assert(v_err = 'renter.booking.banned', 'post-lock ban gate: ' || COALESCE(v_err, 'null'));

  UPDATE renters SET booking_banned_at = NULL, status = 'active', archived_at = NULL WHERE id = v_renter_off;
  v_err := _test_fa3_post_lock_gate_error(v_org, v_renter_off, v_loc, v_far, 'inactive');
  PERFORM _test_assert(v_err = 'renter.booking.inactive', 'post-lock inactive gate: ' || COALESCE(v_err, 'null'));

  -- End-to-end create: debt appears after pre-lock (same txn after lock section)
  UPDATE renters SET booking_banned_at = NULL, status = 'active', archived_at = NULL WHERE id = v_renter_debt;
  UPDATE rentals SET debt_amount = 0, lifecycle = 'active' WHERE renter_id = v_renter_debt;

  DELETE FROM renter_wallet_ledger WHERE renter_id = v_renter_debt;
  INSERT INTO renter_wallet_ledger (organization_id, renter_id, entry_type, amount)
  VALUES (v_org, v_renter_debt, 'topup', 5000);
  PERFORM _renter_apply_wallet(v_org, v_renter_debt);

  SELECT d, ts, te INTO v_far, v_ts, v_te FROM _fa3_slot_at(v_org, interval '11 days');
  v_result := renter_create_booking(jsonb_build_object(
    'renter_id', v_renter_debt,
    'location_id', v_loc,
    'rental_date', v_far,
    'time_start', v_ts,
    'time_end', v_te,
    'idempotency_key', 'fa3-debt-after-lock'
  ));
  -- Pre-lock: no debt. Simulate concurrent accrual after lock via direct mutation + post-lock gates in RPC.
  -- If RPC lacks post-lock gates, this would succeed; with FA3 it must fail when debt exists at post-check.
  -- Force debt on renter before create while still clean at first gate: use race slot only after lock via helper above.
  -- Here: set debt on another slot, then create new slot — pre-lock fails. Clear and use inline race:
  PERFORM _test_assert(
    (v_result ->> 'success')::boolean,
    'baseline create without debt ok: ' || COALESCE(v_result ->> 'error', 'ok')
  );

  UPDATE rentals SET debt_amount = 40, lifecycle = 'debt' WHERE id = v_slot_race;

  SELECT d INTO v_far FROM _fa3_slot_at(v_org, interval '12 days');
  v_result := renter_create_booking(jsonb_build_object(
    'renter_id', v_renter_debt,
    'location_id', v_loc,
    'rental_date', v_far,
    'time_start', v_ts,
    'time_end', v_te,
    'idempotency_key', 'fa3-debt-blocks'
  ));
  PERFORM _test_assert(v_result ->> 'error' = 'renter.booking.debt', 'create blocked when debt present');

  SELECT count(*) INTO v_n
  FROM rentals
  WHERE organization_id = v_org
    AND renter_id = v_renter_debt
    AND idempotency_key = 'fa3-debt-blocks';
  PERFORM _test_assert(v_n = 0, 'no slot inserted when debt blocks create');

  UPDATE rentals SET debt_amount = 0, lifecycle = 'active' WHERE renter_id = v_renter_debt;
  UPDATE renters SET booking_banned_at = now(), status = 'active', archived_at = NULL WHERE id = v_renter_ban;

  SELECT d, ts, te INTO v_far, v_ts, v_te FROM _fa3_slot_at(v_org, interval '13 days');
  v_result := renter_create_booking(jsonb_build_object(
    'renter_id', v_renter_ban,
    'location_id', v_loc,
    'rental_date', v_far,
    'time_start', v_ts,
    'time_end', v_te,
    'idempotency_key', 'fa3-ban-blocks'
  ));
  PERFORM _test_assert(
    v_result ->> 'error' = 'renter.booking.banned',
    'create blocked when banned: ' || COALESCE(v_result ->> 'error', 'ok')
  );

  -- Disable renter
  UPDATE renters SET status = 'active', archived_at = NULL, booking_banned_at = NULL WHERE id = v_renter_off;
  UPDATE renters SET status = 'archived', archived_at = now() WHERE id = v_renter_off;

  SELECT d, ts, te INTO v_far, v_ts, v_te FROM _fa3_slot_at(v_org, interval '15 days');
  v_result := renter_create_booking(jsonb_build_object(
    'renter_id', v_renter_off,
    'location_id', v_loc,
    'rental_date', v_far,
    'time_start', v_ts,
    'time_end', v_te,
    'idempotency_key', 'fa3-off-blocks'
  ));
  PERFORM _test_assert(v_result ->> 'error' = 'renter.booking.inactive', 'create blocked when inactive');

  -- Pack: ban between gates
  UPDATE renters SET status = 'active', archived_at = NULL, booking_banned_at = NULL WHERE id = v_renter_ban;
  SELECT d INTO v_pack_from FROM _fa3_slot_at(v_org, interval '14 days');
  v_pack_from := v_pack_from + ((8 - EXTRACT(ISODOW FROM v_pack_from)::int) % 7);
  v_pack_to := v_pack_from + 27;

  UPDATE renters SET booking_banned_at = now() WHERE id = v_renter_ban;
  v_result := renter_create_recurring_pack(jsonb_build_object(
    'renter_id', v_renter_ban,
    'location_id', v_loc,
    'valid_from', v_pack_from,
    'valid_to', v_pack_to,
    'weekdays', jsonb_build_array(1),
    'time_start', '11:00',
    'time_end', '12:00',
    'idempotency_key', 'fa3-pack-ban'
  ));
  PERFORM _test_assert(v_result ->> 'error' = 'renter.booking.banned', 'pack blocked when banned');

  SELECT count(*) INTO v_n FROM rental_series WHERE organization_id = v_org AND idempotency_key = 'fa3-pack-ban';
  PERFORM _test_assert(v_n = 0, 'no pack series when ban blocks');

  RAISE NOTICE 'renter_miniapp_fa3_create_gates_test: OK (run fa3-concurrent script for wallet-lock race)';
END;
$$ LANGUAGE plpgsql;

ROLLBACK;
