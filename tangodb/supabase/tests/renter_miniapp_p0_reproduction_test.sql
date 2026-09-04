-- F0a / FA1: SQL reproduction P0-02, P0-03 + FA1 extras (surcharge spendable, repeat early-close, debt chain).
-- P0-01 (staff-topup) lives in renter_miniapp_p0_fa2_reproduction_test.sql until FA2.
-- Run: npm run test:db:renter-miniapp-p0
-- Or: psql "%DATABASE_URL%" -v ON_ERROR_STOP=1 -f supabase/tests/_hall_rent_test_jwt.sql -f supabase/tests/renter_miniapp_p0_reproduction_test.sql

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
  v_org uuid := 'a0f00000-0000-4000-8000-000000000001';
  v_user uuid := 'a0f00000-0000-4000-8000-000000000011';
  v_member uuid := 'a0f00000-0000-4000-8000-000000000021';
  v_loc uuid := 'a0f00000-0000-4000-8000-0000000000aa';
  v_renter_p02 uuid := 'a0f00000-0000-4000-8000-000000000042';
  v_renter_p03 uuid := 'a0f00000-0000-4000-8000-000000000043';
  v_renter_spend uuid := 'a0f00000-0000-4000-8000-000000000044';
  v_renter_chain uuid := 'a0f00000-0000-4000-8000-000000000045';
  v_series uuid := 'a0f00000-0000-4000-8000-000000000051';
  v_series_repeat uuid := 'a0f00000-0000-4000-8000-000000000052';
  v_series_chain uuid := 'a0f00000-0000-4000-8000-000000000053';
  v_slot_debt uuid := 'a0f00000-0000-4000-8000-000000000061';
  v_slot_terminal uuid := 'a0f00000-0000-4000-8000-000000000062';
  v_slot_spend uuid := 'a0f00000-0000-4000-8000-000000000063';
  v_slot_term_spend uuid := 'a0f00000-0000-4000-8000-000000000064';
  v_slot_chain uuid := 'a0f00000-0000-4000-8000-000000000065';
  v_slot_chain_term uuid := 'a0f00000-0000-4000-8000-000000000066';
  v_rental_debt uuid := 'a0f00000-0000-4000-8000-000000000071';
  v_key uuid;
  v_debt numeric;
  v_balance numeric;
  v_balance_before numeric;
  v_n int;
  v_tz text;
  v_past date;
  v_status text;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES (
    v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'p0-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(),
    '{}'::jsonb, '{}'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'P0 Repro Org', 'p0-repro', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed', owner_user_id = EXCLUDED.owner_user_id;

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET license_type = 'lifetime', activated_at = now();

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES (v_member, v_org, v_user, 'owner', 'P0 Owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, currency_code, locale)
  VALUES (v_org, 'Europe/Moscow', 'RUB', 'ru')
  ON CONFLICT (organization_id) DO UPDATE SET
    timezone = EXCLUDED.timezone,
    currency_code = EXCLUDED.currency_code,
    finance_period_closed_until = NULL;

  INSERT INTO locations (id, organization_id, name, miniapp_enabled)
  VALUES (v_loc, v_org, 'P0 Hall', true)
  ON CONFLICT (id) DO UPDATE SET miniapp_enabled = true;

  INSERT INTO renters (id, organization_id, display_name, status)
  VALUES
    (v_renter_p02, v_org, 'P0 Early Close', 'active'),
    (v_renter_p03, v_org, 'P0 Repeat Settle', 'active'),
    (v_renter_spend, v_org, 'FA1 Surcharge Spendable', 'active'),
    (v_renter_chain, v_org, 'FA1 Debt Chain', 'active')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization_addons (organization_id, addon_code, status, period_start, period_end)
  VALUES (v_org, 'renter_miniapp', 'active', CURRENT_DATE - 1, CURRENT_DATE + 365)
  ON CONFLICT (organization_id, addon_code) DO UPDATE SET
    status = 'active', period_start = EXCLUDED.period_start, period_end = EXCLUDED.period_end;

  INSERT INTO location_rental_hour_rates (organization_id, location_id, kind, price, currency, valid_from)
  VALUES
    (v_org, v_loc, 'one_time', 1000, 'RUB', DATE '2000-01-01'),
    (v_org, v_loc, 'recurring', 800, 'RUB', DATE '2000-01-01'),
    (v_org, v_loc, 'penalty', 1500, 'RUB', DATE '2000-01-01');

  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');
  v_tz := _org_timezone(v_org);
  v_past := (now() AT TIME ZONE v_tz)::date - 2;

  -- ---------------------------------------------------------------------------
  -- P0-02 early-close surcharge does not double-count existing remainder debt
  -- ---------------------------------------------------------------------------
  INSERT INTO rental_series (
    id, organization_id, renter_id, location_id, tariff_id, valid_from, valid_to, status, channel
  )
  VALUES (
    v_series, v_org, v_renter_p02, v_loc, NULL,
    v_past - 7, v_past + 7, 'active', 'miniapp'
  )
  ON CONFLICT (id) DO UPDATE SET status = 'active', channel = 'miniapp';

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, rental_series_id,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, calculated_amount, currency,
    prepay_charged_at, remainder_charged_at
  )
  VALUES (
    v_slot_debt, v_org, v_renter_p02, v_loc, v_past, '10:00', '11:00',
    'confirmed', 'miniapp', 'debt', v_series,
    400, 400, 400, 800, 800, 'RUB',
    now() - interval '3 days', NULL
  )
  ON CONFLICT (id) DO UPDATE SET
    lifecycle = 'debt',
    debt_amount = 400,
    debt_charge_seq = 1,
    prepay_charged_at = now() - interval '3 days',
    remainder_charged_at = NULL;

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, rental_series_id,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, calculated_amount, currency,
    cancelled_at, cancelled_reason
  )
  VALUES (
    v_slot_terminal, v_org, v_renter_p02, v_loc, v_past - 1, '12:00', '13:00',
    'cancelled', 'miniapp', 'cancelled', v_series,
    400, 400, 0, 800, 800, 'RUB',
    now() - interval '4 days', 'miniapp_cancel_retain'
  )
  ON CONFLICT (id) DO UPDATE SET lifecycle = 'cancelled', cancelled_at = EXCLUDED.cancelled_at;

  PERFORM _test_assert(
    _renter_wallet_spendable(v_org, v_renter_p02) = 0,
    'P0-02 fixture: spendable is 0'
  );

  PERFORM _renter_early_close_pack(v_series);

  SELECT debt_amount INTO v_debt FROM rentals WHERE id = v_slot_debt;
  PERFORM _test_assert(
    v_debt = 600,
    'P0-02: debt=600 after recalc 1000−400 charged (got ' || COALESCE(v_debt::text, 'null') || ')'
  );
  PERFORM _test_assert(
    (SELECT count(*) FROM renter_wallet_ledger
     WHERE rental_id = v_slot_debt AND entry_type = 'surcharge_one_time_recalc') = 0,
    'P0-02: no wallet debit when spendable=0'
  );

  -- ---------------------------------------------------------------------------
  -- FA1: repeat early-close is no-op after series cancelled
  -- ---------------------------------------------------------------------------
  SELECT status INTO v_status FROM rental_series WHERE id = v_series;
  PERFORM _test_assert(v_status = 'cancelled', 'FA1 repeat early-close: series cancelled after first pass');

  PERFORM _renter_early_close_pack(v_series);
  SELECT debt_amount INTO v_debt FROM rentals WHERE id = v_slot_debt;
  PERFORM _test_assert(
    v_debt = 600,
    'FA1 repeat early-close: debt unchanged on second call'
  );

  -- ---------------------------------------------------------------------------
  -- FA1: surcharge when spendable > 0 takes from wallet, rest to debt
  -- ---------------------------------------------------------------------------
  INSERT INTO rental_series (
    id, organization_id, renter_id, location_id, tariff_id, valid_from, valid_to, status, channel
  )
  VALUES (
    v_series_repeat, v_org, v_renter_spend, v_loc, NULL,
    v_past - 7, v_past + 7, 'active', 'miniapp'
  )
  ON CONFLICT (id) DO UPDATE SET status = 'active', channel = 'miniapp';

  INSERT INTO renter_wallet_ledger (organization_id, renter_id, entry_type, amount)
  VALUES (v_org, v_renter_spend, 'topup', 300);

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, rental_series_id,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, calculated_amount, currency,
    prepay_charged_at, remainder_charged_at
  )
  VALUES (
    v_slot_spend, v_org, v_renter_spend, v_loc, v_past, '10:00', '11:00',
    'confirmed', 'miniapp', 'prepaid_charged', v_series_repeat,
    400, 400, 0, 800, 800, 'RUB',
    now() - interval '3 days', NULL
  )
  ON CONFLICT (id) DO UPDATE SET
    lifecycle = 'prepaid_charged',
    debt_amount = 0,
    debt_charge_seq = 0,
    prepay_charged_at = now() - interval '3 days',
    remainder_charged_at = NULL;

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, rental_series_id,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, calculated_amount, currency,
    cancelled_at, cancelled_reason
  )
  VALUES (
    v_slot_term_spend, v_org, v_renter_spend, v_loc, v_past - 1, '12:00', '13:00',
    'cancelled', 'miniapp', 'cancelled', v_series_repeat,
    400, 400, 0, 800, 800, 'RUB',
    now() - interval '4 days', 'miniapp_cancel_retain'
  )
  ON CONFLICT (id) DO UPDATE SET lifecycle = 'cancelled', cancelled_at = EXCLUDED.cancelled_at;

  PERFORM _renter_early_close_pack(v_series_repeat);

  SELECT debt_amount INTO v_debt FROM rentals WHERE id = v_slot_spend;
  PERFORM _test_assert(
    v_debt = 300,
    'FA1 surcharge spendable: debt=300 after 300 wallet + 300 debt (got ' || COALESCE(v_debt::text, 'null') || ')'
  );
  PERFORM _test_assert(
    (SELECT sum(amount) FROM renter_wallet_ledger
     WHERE rental_id = v_slot_spend AND entry_type = 'surcharge_one_time_recalc') = 300,
    'FA1 surcharge spendable: wallet debited 300'
  );
  PERFORM _test_assert(
    _renter_wallet_balance(v_org, v_renter_spend) = 0,
    'FA1 surcharge spendable: balance exhausted'
  );

  -- ---------------------------------------------------------------------------
  -- P0-03 repeat debt settle uses separate phase per obligation
  -- ---------------------------------------------------------------------------
  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, calculated_amount, currency
  )
  VALUES (
    v_rental_debt, v_org, v_renter_p03, v_loc, v_past, '14:00', '15:00',
    'confirmed', 'miniapp', 'debt',
    400, 400, 200, 800, 800, 'RUB'
  )
  ON CONFLICT (id) DO UPDATE SET debt_amount = 200, lifecycle = 'debt', debt_charge_seq = 1;

  INSERT INTO renter_wallet_ledger (organization_id, renter_id, entry_type, amount)
  VALUES (v_org, v_renter_p03, 'topup', 500);

  PERFORM _renter_debt_settle(v_org, v_renter_p03);
  PERFORM _test_assert(
    (SELECT debt_amount FROM rentals WHERE id = v_rental_debt) = 0,
    'P0-03: first settle clears debt'
  );
  PERFORM _test_assert(
    (SELECT count(*) FROM renter_wallet_ledger
     WHERE rental_id = v_rental_debt AND entry_type = 'debt_settle') = 1,
    'P0-03: first settle writes one debt_settle ledger row'
  );

  UPDATE rentals
  SET debt_amount = 200, lifecycle = 'debt', updated_at = now()
  WHERE id = v_rental_debt;

  v_balance_before := _renter_wallet_balance(v_org, v_renter_p03);
  PERFORM _renter_debt_settle(v_org, v_renter_p03);

  PERFORM _test_assert(
    (SELECT debt_amount FROM rentals WHERE id = v_rental_debt) = 0,
    'P0-03: second settle clears new debt_amount'
  );
  PERFORM _test_assert(
    _renter_wallet_balance(v_org, v_renter_p03) = v_balance_before - 200,
    'P0-03: wallet debited 200 on second settle (got balance ' || _renter_wallet_balance(v_org, v_renter_p03) || ')'
  );
  PERFORM _test_assert(
    (SELECT count(*) FROM renter_wallet_ledger
     WHERE rental_id = v_rental_debt AND entry_type = 'debt_settle') >= 2,
    'P0-03: separate debt_settle debit per obligation'
  );

  -- ---------------------------------------------------------------------------
  -- FA1: debt → settle → surcharge debt → settle converges balance and debits
  -- ---------------------------------------------------------------------------
  INSERT INTO rental_series (
    id, organization_id, renter_id, location_id, tariff_id, valid_from, valid_to, status, channel
  )
  VALUES (
    v_series_chain, v_org, v_renter_chain, v_loc, NULL,
    v_past - 7, v_past + 7, 'active', 'miniapp'
  )
  ON CONFLICT (id) DO UPDATE SET status = 'active', channel = 'miniapp';

  DELETE FROM renter_wallet_ledger WHERE renter_id = v_renter_chain;
  INSERT INTO renter_wallet_ledger (organization_id, renter_id, entry_type, amount)
  VALUES (v_org, v_renter_chain, 'topup', 500);
  PERFORM _renter_apply_wallet(v_org, v_renter_chain);

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, rental_series_id,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, calculated_amount, currency,
    prepay_charged_at, remainder_charged_at
  )
  VALUES (
    v_slot_chain, v_org, v_renter_chain, v_loc, v_past, '10:00', '11:00',
    'confirmed', 'miniapp', 'debt', v_series_chain,
    400, 0, 200, 800, 800, 'RUB',
    now() - interval '3 days', NULL
  )
  ON CONFLICT (id) DO UPDATE SET
    lifecycle = 'debt',
    debt_amount = 200,
    remainder_amount = 0,
    debt_charge_seq = 1,
    prepay_charged_at = now() - interval '3 days',
    remainder_charged_at = NULL;

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, rental_series_id,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, calculated_amount, currency,
    cancelled_at, cancelled_reason
  )
  VALUES (
    v_slot_chain_term, v_org, v_renter_chain, v_loc, v_past - 1, '12:00', '13:00',
    'cancelled', 'miniapp', 'cancelled', v_series_chain,
    400, 400, 0, 800, 800, 'RUB',
    now() - interval '4 days', 'miniapp_cancel_retain'
  )
  ON CONFLICT (id) DO UPDATE SET lifecycle = 'cancelled', cancelled_at = EXCLUDED.cancelled_at;

  PERFORM _renter_debt_settle(v_org, v_renter_chain);
  PERFORM _test_assert(
    (SELECT debt_amount FROM rentals WHERE id = v_slot_chain) = 0,
    'FA1 chain: first settle clears initial debt'
  );

  UPDATE rental_series SET status = 'active', updated_at = now() WHERE id = v_series_chain;

  PERFORM _renter_early_close_pack(v_series_chain);

  SELECT debt_amount INTO v_debt FROM rentals WHERE id = v_slot_chain;
  PERFORM _test_assert(
    v_debt = 300,
    'FA1 chain: early-close assigns surcharge debt 300 after partial wallet take (got ' || COALESCE(v_debt::text, 'null') || ')'
  );

  INSERT INTO renter_wallet_ledger (organization_id, renter_id, entry_type, amount)
  VALUES (v_org, v_renter_chain, 'topup', 300);

  PERFORM _renter_debt_settle(v_org, v_renter_chain);
  PERFORM _test_assert(
    (SELECT debt_amount FROM rentals WHERE id = v_slot_chain) = 0,
    'FA1 chain: second settle clears surcharge debt'
  );
  PERFORM _test_assert(
    _renter_wallet_balance(v_org, v_renter_chain) = 0,
    'FA1 chain: balance converged to zero'
  );
  PERFORM _test_assert(
    (SELECT count(*) FROM renter_wallet_ledger
     WHERE rental_id = v_slot_chain AND entry_type = 'debt_settle') = 2,
    'FA1 chain: two debt_settle debits for two obligations'
  );

  RAISE NOTICE 'renter_miniapp_p0_reproduction_test: FA1 invariants passed';
END;
$$;

ROLLBACK;
