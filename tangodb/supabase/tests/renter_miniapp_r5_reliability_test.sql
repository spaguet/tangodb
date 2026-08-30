-- R5: reliability 50/75, penalty bounce, ban, reset.
-- Run: psql "%DATABASE_URL%" -v ON_ERROR_STOP=1 -f supabase/tests/_hall_rent_test_jwt.sql -f supabase/tests/renter_miniapp_r5_reliability_test.sql

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

CREATE OR REPLACE FUNCTION _r5_purge_renter(p_renter uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM renter_reliability_events WHERE renter_id = p_renter;
  DELETE FROM renter_telegram_outbox WHERE renter_id = p_renter;
  DELETE FROM renter_wallet_ledger WHERE renter_id = p_renter;
  DELETE FROM rentals WHERE renter_id = p_renter;
  DELETE FROM rental_series WHERE renter_id = p_renter;
  UPDATE renters
  SET
    on_time_count = 0,
    untimely_count = 0,
    booking_banned_at = NULL,
    penalty_tariff_applied_at = NULL,
    auth_user_id = NULL
  WHERE id = p_renter;
END;
$$;

DO $$
DECLARE
  v_version_id uuid;
  v_org uuid := 'a1d00000-0000-4000-8000-000000000002';
  v_user uuid := 'a1d00000-0000-4000-8000-000000000015';
  v_member uuid := 'a1d00000-0000-4000-8000-000000000025';
  v_loc uuid := 'a1d00000-0000-4000-8000-0000000000ab';
  v_loc2 uuid := 'a1d00000-0000-4000-8000-0000000000ac';
  v_renter uuid := 'a1d00000-0000-4000-8000-000000000051';
  v_renter_user uuid := 'a1d00000-0000-4000-8000-000000000055';
  v_tz text;
  v_id uuid;
  v_id2 uuid;
  v_life text;
  v_hold timestamptz;
  v_untimely int;
  v_on_time int;
  v_banned timestamptz;
  v_penalty timestamptz;
  v_prepay numeric;
  v_reserved numeric;
  v_outbox int;
  v_result jsonb;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES (
    v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'r5-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(), '{}'::jsonb, '{}'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'R5 Reliability Org', 'r5-reliability', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed';

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET license_type = 'lifetime';

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'R5 Owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, currency_code, locale)
  VALUES (v_org, 'Europe/Moscow', 'RUB', 'ru')
  ON CONFLICT (organization_id) DO UPDATE SET finance_period_closed_until = NULL;

  INSERT INTO locations (id, organization_id, name, miniapp_enabled)
  VALUES
    (v_loc, v_org, 'Hall R5', true),
    (v_loc2, v_org, 'Hall R5 No Penalty', true)
  ON CONFLICT (id) DO UPDATE SET miniapp_enabled = true;

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES (
    v_renter_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'r5-renter@users.invalid', crypt('testpass123', gen_salt('bf')), now(), now(), now(),
    jsonb_build_object('actor', 'renter', 'organization_id', v_org::text, 'telegram_id', '93001'),
    '{}'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO renters (id, organization_id, display_name, telegram_id, status, auth_user_id)
  VALUES (v_renter, v_org, 'R5 Renter', 93001, 'active', v_renter_user)
  ON CONFLICT (id) DO UPDATE SET
    telegram_id = EXCLUDED.telegram_id,
    status = 'active',
    auth_user_id = EXCLUDED.auth_user_id;

  INSERT INTO organization_addons (organization_id, addon_code, status, period_start, period_end)
  VALUES (v_org, 'renter_miniapp', 'active', CURRENT_DATE - 1, CURRENT_DATE + 365)
  ON CONFLICT (organization_id, addon_code) DO UPDATE SET status = 'active';

  INSERT INTO location_rental_hour_rates (organization_id, location_id, kind, price, currency, valid_from)
  VALUES
    (v_org, v_loc, 'one_time', 1000, 'RUB', DATE '2000-01-01'),
    (v_org, v_loc, 'recurring', 800, 'RUB', DATE '2000-01-01'),
    (v_org, v_loc, 'penalty', 2000, 'RUB', DATE '2000-01-01'),
    (v_org, v_loc2, 'one_time', 1000, 'RUB', DATE '2000-01-01'),
    (v_org, v_loc2, 'recurring', 800, 'RUB', DATE '2000-01-01')
  ON CONFLICT DO NOTHING;

  DELETE FROM location_rental_hour_rates
  WHERE organization_id = v_org
    AND location_id = v_loc2
    AND kind = 'penalty';

  v_tz := _org_timezone(v_org);

  PERFORM _test_assert(
    _renter_org_penalty_rate_gap(v_org),
    'penalty_rate_gap true when enabled hall lacks penalty rate'
  );

  -- ---------------------------------------------------------------------------
  -- untimely idempotent + threshold 50% penalty bounce
  -- ---------------------------------------------------------------------------
  PERFORM _r5_purge_renter(v_renter);
  v_id := (
    SELECT r.id FROM rentals r
    WHERE r.organization_id = v_org AND r.renter_id = v_renter
    LIMIT 1
  );
  IF v_id IS NULL THEN
    INSERT INTO rentals (
      organization_id, renter_id, location_id, rental_date, time_start, time_end,
      booking_status, channel, lifecycle, hold_expires_at,
      prepay_amount, remainder_amount, debt_amount, fixed_amount, calculated_amount, currency
    )
    VALUES (
      v_org, v_renter, v_loc,
      (now() AT TIME ZONE v_tz)::date + 2, '18:00', '19:00',
      'confirmed', 'miniapp', 'awaiting_payment', now() - interval '1 minute',
      500, 500, 0, 1000, 1000, 'RUB'
    )
    RETURNING id INTO v_id;
  END IF;

  PERFORM _renter_apply_reliability(v_id, 'untimely', true);
  PERFORM _renter_apply_reliability(v_id, 'untimely', true);
  SELECT untimely_count INTO v_untimely FROM renters WHERE id = v_renter;
  PERFORM _test_assert(v_untimely = 1, 'untimely++ idempotent with rental_id+phase');

  UPDATE renters SET on_time_count = 3, untimely_count = 3 WHERE id = v_renter;
  PERFORM _renter_evaluate_reliability_thresholds(v_org, v_renter);
  SELECT penalty_tariff_applied_at INTO v_penalty FROM renters WHERE id = v_renter;
  PERFORM _test_assert(v_penalty IS NOT NULL, '50% ratio applies penalty tariff when rates exist');

  -- active bounce: higher prepay, reserve released (no wallet — FIFO must not re-activate)
  PERFORM _r5_purge_renter(v_renter);
  INSERT INTO rentals (
    organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, hold_expires_at,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, calculated_amount, currency
  )
  VALUES (
    v_org, v_renter, v_loc,
    (now() AT TIME ZONE v_tz)::date + 3, '18:00', '19:00',
    'confirmed', 'miniapp', 'active', now() + interval '12 hours',
    500, 500, 0, 1000, 1000, 'RUB'
  )
  RETURNING id INTO v_id;
  v_hold := (SELECT hold_expires_at FROM rentals WHERE id = v_id);
  UPDATE renters SET penalty_tariff_applied_at = now() WHERE id = v_renter;
  PERFORM _renter_bounce_penalty_snapshots(v_org, v_renter);
  SELECT lifecycle, prepay_amount INTO v_life, v_prepay FROM rentals WHERE id = v_id;
  PERFORM _test_assert(v_life = 'awaiting_payment', 'penalty bounce active→awaiting');
  PERFORM _test_assert(v_prepay = 1000, 'penalty bounce doubles prepay snapshot');
  PERFORM _test_assert(
    (SELECT hold_expires_at FROM rentals WHERE id = v_id) = v_hold,
    'penalty bounce keeps hold_expires_at'
  );
  v_reserved := _renter_wallet_reserved_prepay(v_org, v_renter);
  PERFORM _test_assert(v_reserved = 0, 'penalty bounce clears reserved_prepay');
  PERFORM _renter_assert_wallet_invariant(v_org, v_renter);

  -- awaiting: snapshot update without timer reset
  PERFORM _r5_purge_renter(v_renter);
  INSERT INTO rentals (
    organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, hold_expires_at,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, calculated_amount, currency
  )
  VALUES (
    v_org, v_renter, v_loc,
    (now() AT TIME ZONE v_tz)::date + 4, '18:00', '19:00',
    'confirmed', 'miniapp', 'awaiting_payment', now() + interval '6 hours',
    500, 500, 0, 1000, 1000, 'RUB'
  )
  RETURNING id INTO v_id;
  v_hold := (SELECT hold_expires_at FROM rentals WHERE id = v_id);
  UPDATE renters SET penalty_tariff_applied_at = now() WHERE id = v_renter;
  PERFORM _renter_bounce_penalty_snapshots(v_org, v_renter);
  SELECT prepay_amount INTO v_prepay FROM rentals WHERE id = v_id;
  PERFORM _test_assert(v_prepay = 1000, 'awaiting penalty bounce updates snapshot');
  PERFORM _test_assert(
    (SELECT hold_expires_at FROM rentals WHERE id = v_id) = v_hold,
    'awaiting penalty bounce does not reset timer'
  );

  -- ---------------------------------------------------------------------------
  -- 75% ban without penalty rate still bans + cancels future
  -- ---------------------------------------------------------------------------
  PERFORM _r5_purge_renter(v_renter);
  INSERT INTO rentals (
    organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, hold_expires_at,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, calculated_amount, currency
  )
  VALUES (
    v_org, v_renter, v_loc2,
    (now() AT TIME ZONE v_tz)::date + 5, '10:00', '11:00',
    'confirmed', 'miniapp', 'awaiting_payment', now() + interval '2 days',
    500, 500, 0, 1000, 1000, 'RUB'
  )
  RETURNING id INTO v_id;
  UPDATE renters SET on_time_count = 1, untimely_count = 3 WHERE id = v_renter;
  PERFORM _renter_evaluate_reliability_thresholds(v_org, v_renter);
  SELECT booking_banned_at, penalty_tariff_applied_at
  INTO v_banned, v_penalty
  FROM renters WHERE id = v_renter;
  PERFORM _test_assert(v_banned IS NOT NULL, '75% bans even without penalty rate');
  PERFORM _test_assert(v_penalty IS NULL, '75% without penalty rate does not set penalty flag');
  SELECT lifecycle INTO v_life FROM rentals WHERE id = v_id;
  PERFORM _test_assert(v_life = 'hold_deleted', 'ban cancels future awaiting hold');

  SELECT count(*) INTO v_outbox
  FROM renter_telegram_outbox
  WHERE renter_id = v_renter AND event_type = 'booking_banned';
  PERFORM _test_assert(v_outbox >= 1, 'ban enqueues booking_banned notification');

  -- ---------------------------------------------------------------------------
  -- on_time at settled; catch-up debt after time_end is not untimely
  -- ---------------------------------------------------------------------------
  PERFORM _r5_purge_renter(v_renter);
  INSERT INTO rentals (
    organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, calculated_amount, currency,
    prepay_charged_at, remainder_charged_at
  )
  VALUES (
    v_org, v_renter, v_loc,
    (now() AT TIME ZONE v_tz)::date - 1, '12:00', '13:00',
    'confirmed', 'miniapp', 'settled',
    500, 500, 0, 1000, 1000, 'RUB',
    now() - interval '2 days', now() - interval '1 day'
  )
  RETURNING id INTO v_id;
  PERFORM _renter_apply_reliability(v_id, 'on_time', true);
  SELECT on_time_count INTO v_on_time FROM renters WHERE id = v_renter;
  PERFORM _test_assert(v_on_time = 1, 'on_time++ recorded');

  PERFORM _r5_purge_renter(v_renter);
  INSERT INTO rentals (
    organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, calculated_amount, currency
  )
  VALUES (
    v_org, v_renter, v_loc,
    (now() AT TIME ZONE v_tz)::date - 1, '14:00', '15:00',
    'confirmed', 'miniapp', 'active',
    500, 500, 0, 1000, 1000, 'RUB'
  )
  RETURNING id INTO v_id;
  PERFORM _renter_expire_and_catchup(v_org, v_renter);
  SELECT lifecycle INTO v_life FROM rentals WHERE id = v_id;
  PERFORM _test_assert(v_life = 'debt', 'catch-up after time_end → debt not auto_deleted');
  SELECT untimely_count INTO v_untimely FROM renters WHERE id = v_renter;
  PERFORM _test_assert(v_untimely = 0, 'catch-up after time_end is not untimely');

  -- ---------------------------------------------------------------------------
  -- reset_renter_reliability (owner)
  -- ---------------------------------------------------------------------------
  UPDATE renters
  SET booking_banned_at = now(), penalty_tariff_applied_at = now(), on_time_count = 2, untimely_count = 2
  WHERE id = v_renter;

  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', v_user::text,
      'role', 'authenticated',
      'organization_id', v_org::text
    )::text,
    true
  );

  v_result := reset_renter_reliability(v_renter);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'reset_renter_reliability succeeds for owner');
  SELECT booking_banned_at, penalty_tariff_applied_at, on_time_count, untimely_count
  INTO v_banned, v_penalty, v_on_time, v_untimely
  FROM renters WHERE id = v_renter;
  PERFORM _test_assert(
    v_banned IS NULL AND v_penalty IS NULL AND v_on_time = 0 AND v_untimely = 0,
    'reset clears ban, penalty flag and counters'
  );
  SELECT count(*) INTO v_outbox
  FROM renter_telegram_outbox
  WHERE renter_id = v_renter AND event_type = 'ban_lifted';
  PERFORM _test_assert(v_outbox >= 1, 'reset enqueues ban_lifted');

  -- worker still enqueues auto_deleted on expiry (R4 regression)
  PERFORM _r5_purge_renter(v_renter);
  INSERT INTO rentals (
    organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, hold_expires_at,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, calculated_amount, currency
  )
  VALUES (
    v_org, v_renter, v_loc,
    (now() AT TIME ZONE v_tz)::date + 1, '18:00', '19:00',
    'confirmed', 'miniapp', 'awaiting_payment', now() - interval '1 minute',
    500, 500, 0, 1000, 1000, 'RUB'
  )
  RETURNING id INTO v_id;
  PERFORM _renter_mark_terminal(v_id, 'auto_deleted', 'miniapp_auto_deleted', NULL);
  SELECT count(*) INTO v_outbox
  FROM renter_telegram_outbox
  WHERE rental_id = v_id AND event_type = 'auto_deleted';
  PERFORM _test_assert(v_outbox >= 1, 'auto_deleted still enqueues after R5 (R4 regression)');

  RAISE NOTICE 'renter_miniapp_r5_reliability_test: OK';
END;
$$;

ROLLBACK;
