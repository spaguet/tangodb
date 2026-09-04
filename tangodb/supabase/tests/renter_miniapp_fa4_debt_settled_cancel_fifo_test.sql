-- FA4 / P1-16, P1-18: debt→settled on full pay; cancel-pack/ban without mid-loop FIFO.
-- Run: npm run test:db:renter-miniapp-fa4

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

CREATE OR REPLACE FUNCTION _fa4_future_slot(p_days int, p_start text, p_end text)
RETURNS TABLE (d date, ts text, te text)
LANGUAGE sql
STABLE
AS $$
  SELECT
    (CURRENT_DATE + p_days)::date,
    p_start,
    p_end;
$$;

DO $$
DECLARE
  v_version_id uuid;
  v_org uuid := 'fa400000-0000-4000-8000-000000000001';
  v_user uuid := 'fa400000-0000-4000-8000-000000000011';
  v_member uuid := 'fa400000-0000-4000-8000-000000000021';
  v_loc uuid := 'fa400000-0000-4000-8000-0000000000aa';
  v_renter uuid := 'fa400000-0000-4000-8000-000000000041';
  v_series uuid := 'fa400000-0000-4000-8000-0000000000a1';
  v_slot_active uuid := 'fa400000-0000-4000-8000-0000000000b1';
  v_slot_await uuid := 'fa400000-0000-4000-8000-0000000000b2';
  v_slot_debt uuid := 'fa400000-0000-4000-8000-0000000000c1';
  v_series_ban uuid := 'fa400000-0000-4000-8000-0000000000a2';
  v_slot_ban_active uuid := 'fa400000-0000-4000-8000-0000000000b3';
  v_slot_ban_await uuid := 'fa400000-0000-4000-8000-0000000000b4';
  v_d1 date;
  v_d2 date;
  v_result jsonb;
  v_life text;
  v_debt numeric;
  v_cancelled int;
  v_invalid int;
  v_chk_ok boolean;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES (
    v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'fa4-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(), '{}'::jsonb, '{}'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'FA4 Org', 'fa4-org', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed';

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET license_type = 'lifetime';

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'FA4 Owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, currency_code, locale, branding_name)
  VALUES (v_org, 'Europe/Moscow', 'RUB', 'ru', 'FA4 Studio')
  ON CONFLICT (organization_id) DO UPDATE SET timezone = EXCLUDED.timezone;

  INSERT INTO locations (id, organization_id, name, miniapp_enabled)
  VALUES (v_loc, v_org, 'Hall FA4', true)
  ON CONFLICT (id) DO UPDATE SET miniapp_enabled = true;

  INSERT INTO renters (id, organization_id, display_name, telegram_id, status)
  VALUES (v_renter, v_org, 'FA4 Renter', 94001, 'active')
  ON CONFLICT (id) DO UPDATE SET status = 'active', booking_banned_at = NULL;

  INSERT INTO organization_addons (organization_id, addon_code, status, period_start, period_end)
  VALUES (v_org, 'renter_miniapp', 'active', CURRENT_DATE - 1, CURRENT_DATE + 365)
  ON CONFLICT (organization_id, addon_code) DO UPDATE SET status = 'active';

  INSERT INTO location_rental_hour_rates (organization_id, location_id, kind, price, currency, valid_from)
  VALUES
    (v_org, v_loc, 'one_time', 1000, 'RUB', DATE '2000-01-01'),
    (v_org, v_loc, 'recurring', 800, 'RUB', DATE '2000-01-01');

  DELETE FROM renter_wallet_ledger WHERE renter_id = v_renter;
  DELETE FROM rentals WHERE renter_id = v_renter;
  DELETE FROM rental_series WHERE renter_id = v_renter;

  INSERT INTO renter_wallet_ledger (organization_id, renter_id, entry_type, amount)
  VALUES (v_org, v_renter, 'topup', 50000);

  SELECT d INTO v_d1 FROM _fa4_future_slot(5, '10:00', '11:00');
  SELECT d INTO v_d2 FROM _fa4_future_slot(5, '12:00', '13:00');

  -- ---------------------------------------------------------------------------
  -- P1-16: remainder debt fully paid → lifecycle settled, debt filters align
  -- ---------------------------------------------------------------------------
  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, calculated_amount, currency,
    prepay_charged_at, remainder_charged_at, debt_charge_seq
  )
  VALUES (
    v_slot_debt, v_org, v_renter, v_loc, v_d1, '14:00', '15:00',
    'confirmed', 'miniapp', 'debt',
    400, 400, 400, 800, 800, 'RUB',
    now() - interval '2 days', NULL, 1
  );

  PERFORM _renter_debt_settle(v_org, v_renter);

  SELECT lifecycle, debt_amount INTO v_life, v_debt FROM rentals WHERE id = v_slot_debt;
  PERFORM _test_assert(v_debt = 0, 'P1-16: debt_amount cleared after settle');
  PERFORM _test_assert(v_life = 'settled', 'P1-16: remainder debt → settled (got ' || COALESCE(v_life, 'null') || ')');
  PERFORM _test_assert(
    _renter_wallet_debt_outstanding(v_org, v_renter) = 0,
    'P1-16: debt_outstanding zero after settle'
  );

  SELECT count(*) INTO v_invalid
  FROM rentals
  WHERE channel = 'miniapp' AND lifecycle = 'debt' AND debt_amount = 0;
  PERFORM _test_assert(v_invalid = 0, 'P1-16: no debt lifecycle with zero amount');

  BEGIN
    UPDATE rentals
    SET debt_amount = 0, lifecycle = 'debt'
    WHERE id = v_slot_debt;
    v_chk_ok := true;
  EXCEPTION
    WHEN check_violation THEN
      v_chk_ok := false;
  END;
  PERFORM _test_assert(NOT v_chk_ok, 'P1-16: CHECK rejects lifecycle=debt with debt_amount=0');

  -- ---------------------------------------------------------------------------
  -- P1-18: cancel-pack on active + awaiting — full batch, no FIFO rollback
  -- ---------------------------------------------------------------------------
  INSERT INTO rental_series (
    id, organization_id, renter_id, location_id, tariff_id, valid_from, valid_to, status, channel
  )
  VALUES (
    v_series, v_org, v_renter, v_loc, NULL, v_d1 - 1, v_d2 + 7, 'active', 'miniapp'
  );

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, rental_series_id,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, calculated_amount, currency,
    prepay_charged_at, hold_expires_at
  )
  VALUES (
    v_slot_active, v_org, v_renter, v_loc, v_d1, '10:00', '11:00',
    'confirmed', 'miniapp', 'active', v_series,
    400, 400, 0, 800, 800, 'RUB',
    now() - interval '1 day', v_d1::timestamp + time '10:00'
  );

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, rental_series_id,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, calculated_amount, currency,
    hold_expires_at
  )
  VALUES (
    v_slot_await, v_org, v_renter, v_loc, v_d1, '12:00', '13:00',
    'confirmed', 'miniapp', 'awaiting_payment', v_series,
    400, 400, 0, 800, 800, 'RUB',
    now() + interval '12 hours'
  );

  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');
  v_result := renter_cancel_pack(v_series);

  PERFORM _test_assert(
    (v_result ->> 'success')::boolean,
    'P1-18 cancel-pack: success (error=' || COALESCE(v_result ->> 'error', 'none') || ')'
  );

  v_cancelled := jsonb_array_length(COALESCE(v_result -> 'cancelled', '[]'::jsonb));
  PERFORM _test_assert(v_cancelled = 2, 'P1-18 cancel-pack: both slots cancelled (got ' || v_cancelled || ')');

  SELECT count(*) INTO v_invalid
  FROM rentals
  WHERE rental_series_id = v_series
    AND lifecycle IN ('awaiting_payment', 'active', 'prepaid_charged');
  PERFORM _test_assert(v_invalid = 0, 'P1-18 cancel-pack: no unfinished slots remain');

  -- ---------------------------------------------------------------------------
  -- P1-18: ban batch cancel on mixed active + awaiting
  -- ---------------------------------------------------------------------------
  INSERT INTO rental_series (
    id, organization_id, renter_id, location_id, tariff_id, valid_from, valid_to, status, channel
  )
  VALUES (
    v_series_ban, v_org, v_renter, v_loc, NULL, v_d1 - 1, v_d2 + 7, 'active', 'miniapp'
  );

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, rental_series_id,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, calculated_amount, currency,
    prepay_charged_at, hold_expires_at
  )
  VALUES (
    v_slot_ban_active, v_org, v_renter, v_loc, v_d2, '10:00', '11:00',
    'confirmed', 'miniapp', 'active', v_series_ban,
    400, 400, 0, 800, 800, 'RUB',
    now() - interval '1 day', v_d2::timestamp + time '10:00'
  );

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, rental_series_id,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, calculated_amount, currency,
    hold_expires_at
  )
  VALUES (
    v_slot_ban_await, v_org, v_renter, v_loc, v_d2, '12:00', '13:00',
    'confirmed', 'miniapp', 'awaiting_payment', v_series_ban,
    400, 400, 0, 800, 800, 'RUB',
    now() + interval '12 hours'
  );

  PERFORM _renter_cancel_future_miniapp_for_ban(v_org, v_renter);

  SELECT count(*) INTO v_invalid
  FROM rentals
  WHERE id IN (v_slot_ban_active, v_slot_ban_await)
    AND lifecycle IN ('awaiting_payment', 'active', 'prepaid_charged');
  PERFORM _test_assert(v_invalid = 0, 'P1-18 ban: both future slots terminal');

  RAISE NOTICE 'renter_miniapp_fa4_debt_settled_cancel_fifo_test: all assertions passed';
END;
$$;

ROLLBACK;
