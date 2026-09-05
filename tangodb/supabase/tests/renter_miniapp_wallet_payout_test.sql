-- Wallet payout: leftover after debt / holds / remainders.
-- Run: npm run test:db:renter-miniapp-wallet-payout

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
  v_org uuid := 'f9860000-0000-4000-8000-000000000001';
  v_user uuid := 'f9860000-0000-4000-8000-000000000011';
  v_teacher_user uuid := 'f9860000-0000-4000-8000-000000000012';
  v_member uuid := 'f9860000-0000-4000-8000-000000000021';
  v_teacher_member uuid := 'f9860000-0000-4000-8000-000000000022';
  v_renter uuid := 'f9860000-0000-4000-8000-000000000041';
  v_renter_debt uuid := 'f9860000-0000-4000-8000-000000000042';
  v_renter_hold uuid := 'f9860000-0000-4000-8000-000000000043';
  v_loc uuid := 'f9860000-0000-4000-8000-000000000031';
  v_slot_debt uuid := 'f9860000-0000-4000-8000-000000000051';
  v_slot_hold uuid := 'f9860000-0000-4000-8000-000000000052';
  v_key uuid;
  v_result jsonb;
  v_preview jsonb;
  v_balance numeric;
  v_spendable numeric;
  v_refundable numeric;
  v_payout_id uuid;
  v_d date;
  v_lifecycle text;
  v_debt numeric;
  v_advance_amount numeric;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES
    (
      v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'wp-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(),
      '{}'::jsonb, '{}'::jsonb
    ),
    (
      v_teacher_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'wp-teacher@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(),
      '{}'::jsonb, '{}'::jsonb
    )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'WP Payout Org', 'wp-wallet-payout', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed', owner_user_id = EXCLUDED.owner_user_id;

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET license_type = 'lifetime', activated_at = now();

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES
    (v_member, v_org, v_user, 'owner', 'WP Owner'),
    (v_teacher_member, v_org, v_teacher_user, 'teacher', 'WP Teacher')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, currency_code, locale)
  VALUES (v_org, 'Europe/Moscow', 'RUB', 'ru')
  ON CONFLICT (organization_id) DO UPDATE SET
    timezone = EXCLUDED.timezone,
    currency_code = EXCLUDED.currency_code,
    finance_period_closed_until = NULL;

  INSERT INTO locations (id, organization_id, name, miniapp_enabled)
  VALUES (v_loc, v_org, 'WP Hall', true)
  ON CONFLICT (id) DO UPDATE SET miniapp_enabled = true;

  INSERT INTO renters (id, organization_id, display_name, status, telegram_id)
  VALUES
    (v_renter, v_org, 'WP Payout Renter', 'active', 98601),
    (v_renter_debt, v_org, 'WP Debt Renter', 'active', 98602),
    (v_renter_hold, v_org, 'WP Hold Renter', 'active', 98603)
  ON CONFLICT (id) DO UPDATE SET
    status = 'active',
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

  DELETE FROM renter_telegram_outbox WHERE organization_id = v_org;
  DELETE FROM renter_wallet_ledger WHERE renter_id IN (v_renter, v_renter_debt, v_renter_hold);
  DELETE FROM rental_advances WHERE renter_id IN (v_renter, v_renter_debt, v_renter_hold);
  DELETE FROM rentals WHERE id IN (v_slot_debt, v_slot_hold);
  DELETE FROM operation_idempotency
  WHERE organization_id = v_org AND scope = 'staff_renter_wallet_payout';

  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');

  -- Baseline: topup 1000, payout 400
  v_result := staff_renter_wallet_topup(jsonb_build_object(
    'renter_id', v_renter,
    'amount', 1000,
    'method', 'cash',
    'idempotency_key', gen_random_uuid()
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'WP topup 1000: ' || COALESCE(v_result ->> 'error', 'ok'));

  v_preview := preview_renter_wallet_payout(jsonb_build_object(
    'renter_id', v_renter,
    'amount', 400
  ));
  PERFORM _test_assert((v_preview ->> 'success')::boolean, 'WP preview: success');
  PERFORM _test_assert(
    (v_preview -> 'quote' ->> 'refundable')::numeric = 1000,
    'WP preview: refundable 1000, got ' || (v_preview -> 'quote' ->> 'refundable')
  );
  PERFORM _test_assert((v_preview ->> 'amount_ok')::boolean, 'WP preview: amount_ok');

  v_result := staff_renter_wallet_payout(jsonb_build_object(
    'renter_id', v_renter,
    'amount', 400,
    'method', 'cash',
    'reason', 'Клиент попросил вернуть часть аванса',
    'application_ack', true,
    'idempotency_key', gen_random_uuid(),
    'external_reference', 'RKO-1'
  ));
  PERFORM _test_assert(
    (v_result ->> 'success')::boolean,
    'WP payout 400: ' || COALESCE(v_result ->> 'error', 'ok')
  );
  v_balance := _renter_wallet_balance(v_org, v_renter);
  PERFORM _test_assert(v_balance = 600, 'WP payout: balance 600, got ' || v_balance);

  SELECT amount INTO v_advance_amount
  FROM rental_advances
  WHERE renter_id = v_renter
  ORDER BY created_at
  LIMIT 1;
  PERFORM _test_assert(v_advance_amount = 600, 'WP payout: advance reduced to 600, got ' || v_advance_amount);

  PERFORM _test_assert(
    EXISTS (
      SELECT 1 FROM renter_wallet_ledger
      WHERE renter_id = v_renter AND entry_type = 'wallet_payout' AND amount = 400
        AND payout_method = 'cash' AND external_reference = 'RKO-1'
    ),
    'WP payout: ledger row'
  );

  PERFORM _test_assert(
    EXISTS (
      SELECT 1 FROM renter_telegram_outbox
      WHERE renter_id = v_renter AND event_type = 'wallet_payout'
    ),
    'WP payout: telegram outbox'
  );

  -- Ack required
  v_result := staff_renter_wallet_payout(jsonb_build_object(
    'renter_id', v_renter,
    'amount', 100,
    'method', 'cash',
    'reason', 'без галочки',
    'application_ack', false,
    'idempotency_key', gen_random_uuid()
  ));
  PERFORM _test_assert(
    v_result ->> 'error' = 'renter.payout.ackRequired',
    'WP ack required, got ' || COALESCE(v_result ->> 'error', 'null')
  );

  -- Exceeds leftover
  v_result := staff_renter_wallet_payout(jsonb_build_object(
    'renter_id', v_renter,
    'amount', 700,
    'method', 'transfer',
    'reason', 'слишком много',
    'application_ack', true,
    'idempotency_key', gen_random_uuid()
  ));
  PERFORM _test_assert(
    v_result ->> 'error' = 'renter.payout.exceedsRefundable',
    'WP exceeds leftover, got ' || COALESCE(v_result ->> 'error', 'null')
  );

  -- Idempotency
  v_key := gen_random_uuid();
  v_result := staff_renter_wallet_payout(jsonb_build_object(
    'renter_id', v_renter,
    'amount', 100,
    'method', 'card',
    'reason', 'повтор ключа',
    'application_ack', true,
    'idempotency_key', v_key
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'WP idempotent first');
  v_payout_id := (v_result ->> 'payout_id')::uuid;
  v_result := staff_renter_wallet_payout(jsonb_build_object(
    'renter_id', v_renter,
    'amount', 100,
    'method', 'card',
    'reason', 'повтор ключа',
    'application_ack', true,
    'idempotency_key', v_key
  ));
  PERFORM _test_assert((v_result ->> 'already_applied')::boolean, 'WP idempotent replay');
  PERFORM _test_assert(
    (v_result ->> 'payout_id')::uuid = v_payout_id,
    'WP idempotent same payout id'
  );
  v_balance := _renter_wallet_balance(v_org, v_renter);
  PERFORM _test_assert(v_balance = 500, 'WP after idempotent payout balance 500, got ' || v_balance);

  -- Teacher cannot payout
  PERFORM _hall_rent_test_set_jwt(v_teacher_user, v_org, v_teacher_member, 'teacher');
  v_result := staff_renter_wallet_payout(jsonb_build_object(
    'renter_id', v_renter,
    'amount', 50,
    'method', 'cash',
    'reason', 'учитель не должен',
    'application_ack', true,
    'idempotency_key', gen_random_uuid()
  ));
  PERFORM _test_assert(
    v_result ->> 'error' = 'renters.error.forbidden',
    'WP teacher forbidden, got ' || COALESCE(v_result ->> 'error', 'null')
  );
  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');

  -- Closed period
  UPDATE organization_settings
  SET finance_period_closed_until = CURRENT_DATE + 1
  WHERE organization_id = v_org;
  v_result := staff_renter_wallet_payout(jsonb_build_object(
    'renter_id', v_renter,
    'amount', 50,
    'method', 'cash',
    'reason', 'закрытый период',
    'application_ack', true,
    'idempotency_key', gen_random_uuid()
  ));
  PERFORM _test_assert(
    v_result ->> 'error' = 'finance.error.periodClosed',
    'WP period closed, got ' || COALESCE(v_result ->> 'error', 'null')
  );
  UPDATE organization_settings
  SET finance_period_closed_until = NULL
  WHERE organization_id = v_org;

  -- Debt keeps 200, leftover 300 of 500
  v_result := staff_renter_wallet_topup(jsonb_build_object(
    'renter_id', v_renter_debt,
    'amount', 500,
    'method', 'cash',
    'idempotency_key', gen_random_uuid()
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'WP debt renter topup');

  v_d := CURRENT_DATE - 2;
  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, currency
  )
  VALUES (
    v_slot_debt, v_org, v_renter_debt, v_loc, v_d, '10:00', '11:00',
    'confirmed', 'miniapp', 'debt',
    250, 250, 200, 500, 'RUB'
  );

  v_preview := preview_renter_wallet_payout(jsonb_build_object('renter_id', v_renter_debt));
  v_refundable := (v_preview -> 'quote' ->> 'refundable')::numeric;
  PERFORM _test_assert(
    v_refundable = 300,
    'WP debt: refundable 300, got ' || v_refundable
      || ' quote=' || (v_preview -> 'quote')::text
  );

  v_result := staff_renter_wallet_payout(jsonb_build_object(
    'renter_id', v_renter_debt,
    'amount', 400,
    'method', 'cash',
    'reason', 'долг нельзя выдать',
    'application_ack', true,
    'idempotency_key', gen_random_uuid()
  ));
  PERFORM _test_assert(
    v_result ->> 'error' = 'renter.payout.exceedsRefundable',
    'WP debt: 400 blocked'
  );

  v_result := staff_renter_wallet_payout(jsonb_build_object(
    'renter_id', v_renter_debt,
    'amount', 300,
    'method', 'cash',
    'reason', 'остаток после долга',
    'application_ack', true,
    'idempotency_key', gen_random_uuid()
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'WP debt: payout 300 ' || COALESCE(v_result ->> 'error', ''));

  SELECT COALESCE(debt_amount, 0) INTO v_debt FROM rentals WHERE id = v_slot_debt;
  v_balance := _renter_wallet_balance(v_org, v_renter_debt);
  PERFORM _test_assert(v_debt = 0, 'WP debt: apply settled debt, remaining ' || v_debt);
  PERFORM _test_assert(v_balance = 0, 'WP debt: wallet 0 after settle, got ' || v_balance);

  -- Hold 400 full cost: leftover 600 of 1000
  v_result := staff_renter_wallet_topup(jsonb_build_object(
    'renter_id', v_renter_hold,
    'amount', 1000,
    'method', 'cash',
    'idempotency_key', gen_random_uuid()
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'WP hold renter topup');

  v_d := CURRENT_DATE + 3;
  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, hold_expires_at,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, currency
  )
  VALUES (
    v_slot_hold, v_org, v_renter_hold, v_loc, v_d, '12:00', '13:00',
    'confirmed', 'miniapp', 'awaiting_payment', now() + interval '20 hours',
    200, 200, 0, 400, 'RUB'
  );

  v_preview := preview_renter_wallet_payout(jsonb_build_object('renter_id', v_renter_hold));
  v_refundable := (v_preview -> 'quote' ->> 'refundable')::numeric;
  PERFORM _test_assert(
    v_refundable = 600,
    'WP hold: refundable 600, got ' || v_refundable
      || ' quote=' || (v_preview -> 'quote')::text
  );

  v_result := staff_renter_wallet_payout(jsonb_build_object(
    'renter_id', v_renter_hold,
    'amount', 700,
    'method', 'transfer',
    'reason', 'холд нельзя оголить',
    'application_ack', true,
    'idempotency_key', gen_random_uuid()
  ));
  PERFORM _test_assert(
    v_result ->> 'error' = 'renter.payout.exceedsRefundable',
    'WP hold: 700 blocked'
  );

  v_result := staff_renter_wallet_payout(jsonb_build_object(
    'renter_id', v_renter_hold,
    'amount', 600,
    'method', 'transfer',
    'reason', 'остаток после полной оплаты холда',
    'application_ack', true,
    'idempotency_key', gen_random_uuid()
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'WP hold: payout 600 ' || COALESCE(v_result ->> 'error', ''));

  SELECT lifecycle INTO v_lifecycle FROM rentals WHERE id = v_slot_hold;
  PERFORM _test_assert(
    v_lifecycle IN ('active', 'prepaid_charged'),
    'WP hold: remaining funds activate hold, lifecycle=' || COALESCE(v_lifecycle, 'null')
  );
  v_balance := _renter_wallet_balance(v_org, v_renter_hold);
  v_spendable := _renter_wallet_spendable(v_org, v_renter_hold);
  PERFORM _test_assert(
    v_balance >= 200 AND v_spendable >= 0,
    'WP hold: wallet covers remainder after activate, balance=' || v_balance
      || ' spendable=' || v_spendable
  );
END;
$$;

ROLLBACK;
