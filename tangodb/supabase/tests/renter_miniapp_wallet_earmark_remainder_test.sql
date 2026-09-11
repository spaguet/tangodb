-- After T−24h of day 1 in a 3-day pack, the unpaid remainder must stay in
-- reserve / not be FIFO-spendable. Remainder charge still takes it at time_end.
-- Run: npm run test:db:renter-miniapp-wallet-earmark-remainder

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
  v_version_id uuid;
  v_org uuid := 'f9890000-0000-4000-8000-000000000001';
  v_user uuid := 'f9890000-0000-4000-8000-000000000011';
  v_member uuid := 'f9890000-0000-4000-8000-000000000021';
  v_loc uuid := 'f9890000-0000-4000-8000-000000000031';
  v_renter uuid := 'f9890000-0000-4000-8000-000000000041';
  v_day1 uuid := 'f9890000-0000-4000-8000-000000000051';
  v_day2 uuid := 'f9890000-0000-4000-8000-000000000052';
  v_day3 uuid := 'f9890000-0000-4000-8000-000000000053';
  v_hold uuid := 'f9890000-0000-4000-8000-000000000061';
  v_tz text;
  v_today date;
  v_far date;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES (
    v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'earmark-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(),
    '{}'::jsonb, '{}'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'Earmark Remainder Org', 'earmark-remainder', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed', owner_user_id = EXCLUDED.owner_user_id;

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET license_type = 'lifetime', activated_at = now();

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'Earmark Owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, currency_code, locale)
  VALUES (v_org, 'Europe/Moscow', 'RUB', 'ru')
  ON CONFLICT (organization_id) DO UPDATE SET
    timezone = EXCLUDED.timezone,
    currency_code = EXCLUDED.currency_code;

  v_tz := _org_timezone(v_org);
  v_today := (now() AT TIME ZONE v_tz)::date;
  v_far := v_today + 14;

  INSERT INTO locations (id, organization_id, name, miniapp_enabled)
  VALUES (v_loc, v_org, 'Earmark Hall', true)
  ON CONFLICT (id) DO UPDATE SET miniapp_enabled = true;

  INSERT INTO renters (id, organization_id, display_name, status, telegram_id)
  VALUES (v_renter, v_org, 'Earmark Renter', 'active', 98901)
  ON CONFLICT (id) DO UPDATE SET status = 'active';

  INSERT INTO organization_addons (organization_id, addon_code, status, period_start, period_end)
  VALUES (v_org, 'renter_miniapp', 'active', CURRENT_DATE - 1, CURRENT_DATE + 365)
  ON CONFLICT (organization_id, addon_code) DO UPDATE SET
    status = 'active', period_start = EXCLUDED.period_start, period_end = EXCLUDED.period_end;

  DELETE FROM rentals WHERE organization_id = v_org;
  DELETE FROM renter_wallet_ledger WHERE organization_id = v_org AND renter_id = v_renter;

  -- Uliana-shaped: posted 4000, T−24h charged 1000, two future 50% still active.
  -- Wallet 3000; three days × 1000 should show as reserve, spendable 0.
  INSERT INTO renter_wallet_ledger (organization_id, renter_id, entry_type, amount)
  VALUES
    (v_org, v_renter, 'topup', 4000),
    (v_org, v_renter, 'prepay_charge', 1000);

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, hold_expires_at,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, currency,
    prepay_charged_at
  )
  VALUES
    (
      v_day1, v_org, v_renter, v_loc, v_today, '21:00', '22:00',
      'confirmed', 'miniapp', 'prepaid_charged', NULL,
      1000, 1000, 0, 2000, 'RUB', now()
    ),
    (
      v_day2, v_org, v_renter, v_loc, v_today + 7, '21:00', '22:00',
      'confirmed', 'miniapp', 'active', NULL,
      1000, 1000, 0, 2000, 'RUB', NULL
    ),
    (
      v_day3, v_org, v_renter, v_loc, v_today + 14, '21:00', '22:00',
      'confirmed', 'miniapp', 'active', NULL,
      1000, 1000, 0, 2000, 'RUB', NULL
    );

  PERFORM _test_assert(_renter_wallet_balance(v_org, v_renter) = 3000, 'wallet 3000 after topup−prepay');
  PERFORM _test_assert(
    _renter_wallet_reserved_active_prepay(v_org, v_renter) = 2000,
    'active uncharged prepays = 2 days'
  );
  PERFORM _test_assert(
    _renter_wallet_earmarked_remainder(v_org, v_renter) = 1000,
    'prepaid_charged remainder earmarked'
  );
  PERFORM _test_assert(
    _renter_wallet_reserved_prepay(v_org, v_renter) = 3000,
    'UI reserve = 3 × 50%'
  );
  PERFORM _test_assert(_renter_wallet_spendable(v_org, v_renter) = 0, 'spendable 0');
  PERFORM _test_assert(_renter_wallet_available(v_org, v_renter) = 0, 'FIFO available 0');
  PERFORM _renter_assert_wallet_invariant(v_org, v_renter);

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, hold_expires_at,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, currency
  )
  VALUES (
    v_hold, v_org, v_renter, v_loc, v_far, '12:00', '13:00',
    'confirmed', 'miniapp', 'awaiting_payment', now() + interval '12 hours',
    1000, 1000, 0, 2000, 'RUB'
  );
  PERFORM _renter_fifo_activate(v_org, v_renter);
  PERFORM _test_assert(
    (SELECT lifecycle FROM rentals WHERE id = v_hold) = 'awaiting_payment',
    'FIFO must not spend earmarked remainder on a new hold'
  );

  PERFORM _test_assert(
    _renter_charge_remainder(v_day1),
    'remainder of day 1 still charges from earmark (not foreign active 50%)'
  );
  PERFORM _test_assert(
    (SELECT lifecycle FROM rentals WHERE id = v_day1) = 'settled',
    'day 1 settled after remainder'
  );
  PERFORM _test_assert(_renter_wallet_balance(v_org, v_renter) = 2000, 'wallet 2000 after remainder');
  PERFORM _test_assert(_renter_wallet_reserved_prepay(v_org, v_renter) = 2000, 'reserve = 2 remaining days');
  PERFORM _test_assert(_renter_wallet_spendable(v_org, v_renter) = 0, 'still no leftover after remainder');
  PERFORM _test_assert(
    (SELECT lifecycle FROM rentals WHERE id = v_hold) = 'awaiting_payment',
    'hold still awaiting after remainder (no extra spendable)'
  );

  -- Exact 3×prepay after T−24h: remainder of day 1 becomes debt, future 50% stay reserved.
  DELETE FROM rentals WHERE organization_id = v_org;
  DELETE FROM renter_wallet_ledger WHERE organization_id = v_org AND renter_id = v_renter;
  INSERT INTO renter_wallet_ledger (organization_id, renter_id, entry_type, amount)
  VALUES
    (v_org, v_renter, 'topup', 3000),
    (v_org, v_renter, 'prepay_charge', 1000);
  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, currency,
    prepay_charged_at
  )
  VALUES
    (
      v_day1, v_org, v_renter, v_loc, v_today, '21:00', '22:00',
      'confirmed', 'miniapp', 'prepaid_charged',
      1000, 1000, 0, 2000, 'RUB', now()
    ),
    (
      v_day2, v_org, v_renter, v_loc, v_today + 7, '21:00', '22:00',
      'confirmed', 'miniapp', 'active',
      1000, 1000, 0, 2000, 'RUB', NULL
    ),
    (
      v_day3, v_org, v_renter, v_loc, v_today + 14, '21:00', '22:00',
      'confirmed', 'miniapp', 'active',
      1000, 1000, 0, 2000, 'RUB', NULL
    );

  PERFORM _test_assert(_renter_wallet_balance(v_org, v_renter) = 2000, 'exact pack wallet 2000');
  PERFORM _test_assert(
    _renter_wallet_reserved_prepay(v_org, v_renter) = 2000,
    'UI reserve capped at wallet when remainder is unfunded'
  );
  PERFORM _test_assert(_renter_wallet_spendable(v_org, v_renter) = 0, 'exact pack spendable 0');
  PERFORM _renter_assert_wallet_invariant(v_org, v_renter);
  PERFORM _test_assert(
    NOT _renter_charge_remainder(v_day1),
    'unfunded remainder → debt, future reserved 50% untouched'
  );
  PERFORM _test_assert(
    (SELECT lifecycle FROM rentals WHERE id = v_day1) = 'debt',
    'day 1 debt when only prepays were funded'
  );
  PERFORM _test_assert(_renter_wallet_reserved_prepay(v_org, v_renter) = 2000, 'future 50% still reserved');
  PERFORM _test_assert(
    (SELECT lifecycle FROM rentals WHERE id = v_day2) = 'active'
      AND (SELECT lifecycle FROM rentals WHERE id = v_day3) = 'active',
    'future slots stay active'
  );
END;
$$;

ROLLBACK;
