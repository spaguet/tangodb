-- Staff wallet amount correction: ledger + advances + floor + audit + roles.
-- Run: npm run test:db:renter-miniapp-wallet-adjust

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
  v_org uuid := 'f9880000-0000-4000-8000-000000000001';
  v_user uuid := 'f9880000-0000-4000-8000-000000000011';
  v_teacher_user uuid := 'f9880000-0000-4000-8000-000000000012';
  v_acct_user uuid := 'f9880000-0000-4000-8000-000000000013';
  v_member uuid := 'f9880000-0000-4000-8000-000000000021';
  v_teacher_member uuid := 'f9880000-0000-4000-8000-000000000022';
  v_acct_member uuid := 'f9880000-0000-4000-8000-000000000023';
  v_renter uuid := 'f9880000-0000-4000-8000-000000000041';
  v_renter_hold uuid := 'f9880000-0000-4000-8000-000000000042';
  v_loc uuid := 'f9880000-0000-4000-8000-000000000031';
  v_slot_hold uuid := 'f9880000-0000-4000-8000-000000000051';
  v_key uuid;
  v_result jsonb;
  v_preview jsonb;
  v_balance numeric;
  v_advance_amount numeric;
  v_ledger_id uuid;
  v_reason text;
  v_created_by uuid;
  v_created_name text;
  v_d date;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES
    (
      v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'wa-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(),
      '{}'::jsonb, '{}'::jsonb
    ),
    (
      v_teacher_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'wa-teacher@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(),
      '{}'::jsonb, '{}'::jsonb
    ),
    (
      v_acct_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'wa-acct@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(),
      '{}'::jsonb, '{}'::jsonb
    )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'WA Adjust Org', 'wa-wallet-adjust', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed', owner_user_id = EXCLUDED.owner_user_id;

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET license_type = 'lifetime', activated_at = now();

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES
    (v_member, v_org, v_user, 'owner', 'WA Owner'),
    (v_teacher_member, v_org, v_teacher_user, 'teacher', 'WA Teacher'),
    (v_acct_member, v_org, v_acct_user, 'accountant', 'WA Accountant')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, currency_code, locale)
  VALUES (v_org, 'Europe/Moscow', 'RUB', 'ru')
  ON CONFLICT (organization_id) DO UPDATE SET
    timezone = EXCLUDED.timezone,
    currency_code = EXCLUDED.currency_code,
    finance_period_closed_until = NULL;

  INSERT INTO locations (id, organization_id, name, miniapp_enabled)
  VALUES (v_loc, v_org, 'WA Hall', true)
  ON CONFLICT (id) DO UPDATE SET miniapp_enabled = true;

  INSERT INTO renters (id, organization_id, display_name, status, telegram_id)
  VALUES
    (v_renter, v_org, 'WA Adjust Renter', 'active', 98801),
    (v_renter_hold, v_org, 'WA Hold Renter', 'active', 98802)
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

  DELETE FROM renter_wallet_ledger WHERE renter_id IN (v_renter, v_renter_hold);
  DELETE FROM rental_advances WHERE renter_id IN (v_renter, v_renter_hold);
  DELETE FROM rentals WHERE id = v_slot_hold;
  DELETE FROM operation_idempotency
  WHERE organization_id = v_org AND scope = 'staff_renter_wallet_adjust';

  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');

  v_result := staff_renter_wallet_topup(jsonb_build_object(
    'renter_id', v_renter,
    'amount', 1000,
    'method', 'cash',
    'idempotency_key', gen_random_uuid()
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'WA topup 1000: ' || COALESCE(v_result ->> 'error', 'ok'));

  v_preview := preview_staff_renter_wallet_adjust(jsonb_build_object(
    'renter_id', v_renter,
    'target_amount', 700
  ));
  PERFORM _test_assert((v_preview ->> 'success')::boolean, 'WA preview: success');
  PERFORM _test_assert((v_preview ->> 'amount_ok')::boolean, 'WA preview: amount_ok debit');
  PERFORM _test_assert(v_preview ->> 'direction' = 'debit', 'WA preview: debit direction');
  PERFORM _test_assert((v_preview ->> 'delta')::numeric = 300, 'WA preview: delta 300');

  v_result := staff_renter_wallet_adjust(jsonb_build_object(
    'renter_id', v_renter,
    'target_amount', 700,
    'reason', 'Ошибочно внесли 1000 вместо 700',
    'idempotency_key', gen_random_uuid()
  ));
  PERFORM _test_assert(
    (v_result ->> 'success')::boolean,
    'WA debit 700: ' || COALESCE(v_result ->> 'error', 'ok')
  );
  v_balance := _renter_wallet_balance(v_org, v_renter);
  PERFORM _test_assert(v_balance = 700, 'WA debit: balance 700, got ' || v_balance);

  SELECT amount INTO v_advance_amount
  FROM rental_advances
  WHERE renter_id = v_renter
  ORDER BY created_at
  LIMIT 1;
  PERFORM _test_assert(v_advance_amount = 700, 'WA debit: advance reduced to 700, got ' || v_advance_amount);

  SELECT l.id, l.correction_reason, l.created_by, m.display_name
  INTO v_ledger_id, v_reason, v_created_by, v_created_name
  FROM renter_wallet_ledger l
  JOIN organization_members m
    ON m.organization_id = l.organization_id AND m.id = l.created_by
  WHERE l.renter_id = v_renter
    AND l.entry_type = 'wallet_correction_debit'
  ORDER BY l.created_at DESC
  LIMIT 1;
  PERFORM _test_assert(v_ledger_id IS NOT NULL, 'WA debit: ledger row');
  PERFORM _test_assert(v_reason = 'Ошибочно внесли 1000 вместо 700', 'WA debit: reason stored');
  PERFORM _test_assert(v_created_by = v_member, 'WA debit: created_by owner');
  PERFORM _test_assert(v_created_name = 'WA Owner', 'WA debit: actor name');

  -- Unchanged
  v_result := staff_renter_wallet_adjust(jsonb_build_object(
    'renter_id', v_renter,
    'target_amount', 700,
    'reason', 'та же сумма',
    'idempotency_key', gen_random_uuid()
  ));
  PERFORM _test_assert(
    v_result ->> 'error' = 'renter.walletAdjust.unchanged',
    'WA unchanged, got ' || COALESCE(v_result ->> 'error', 'null')
  );

  -- Credit back toward original
  v_result := staff_renter_wallet_adjust(jsonb_build_object(
    'renter_id', v_renter,
    'target_amount', 900,
    'reason', 'недобрали 200 при правке',
    'idempotency_key', gen_random_uuid()
  ));
  PERFORM _test_assert(
    (v_result ->> 'success')::boolean,
    'WA credit 900: ' || COALESCE(v_result ->> 'error', 'ok')
  );
  v_balance := _renter_wallet_balance(v_org, v_renter);
  PERFORM _test_assert(v_balance = 900, 'WA credit: balance 900, got ' || v_balance);
  PERFORM _test_assert(
    EXISTS (
      SELECT 1 FROM renter_wallet_ledger
      WHERE renter_id = v_renter AND entry_type = 'wallet_correction_credit' AND amount = 200
    ),
    'WA credit: ledger credit 200'
  );

  -- Idempotency
  v_key := gen_random_uuid();
  v_result := staff_renter_wallet_adjust(jsonb_build_object(
    'renter_id', v_renter,
    'target_amount', 850,
    'reason', 'повтор ключа правки',
    'idempotency_key', v_key
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'WA idempotent first');
  v_ledger_id := (v_result ->> 'ledger_id')::uuid;
  v_result := staff_renter_wallet_adjust(jsonb_build_object(
    'renter_id', v_renter,
    'target_amount', 850,
    'reason', 'повтор ключа правки',
    'idempotency_key', v_key
  ));
  PERFORM _test_assert((v_result ->> 'already_applied')::boolean, 'WA idempotent replay');
  PERFORM _test_assert(
    (v_result ->> 'ledger_id')::uuid = v_ledger_id,
    'WA idempotent same ledger id'
  );
  v_balance := _renter_wallet_balance(v_org, v_renter);
  PERFORM _test_assert(v_balance = 850, 'WA after idempotent balance 850, got ' || v_balance);

  -- Teacher forbidden
  PERFORM _hall_rent_test_set_jwt(v_teacher_user, v_org, v_teacher_member, 'teacher');
  v_result := staff_renter_wallet_adjust(jsonb_build_object(
    'renter_id', v_renter,
    'target_amount', 800,
    'reason', 'учитель не должен',
    'idempotency_key', gen_random_uuid()
  ));
  PERFORM _test_assert(
    v_result ->> 'error' = 'renters.error.forbidden',
    'WA teacher forbidden, got ' || COALESCE(v_result ->> 'error', 'null')
  );

  -- Accountant allowed
  PERFORM _hall_rent_test_set_jwt(v_acct_user, v_org, v_acct_member, 'accountant');
  v_result := staff_renter_wallet_adjust(jsonb_build_object(
    'renter_id', v_renter,
    'target_amount', 800,
    'reason', 'бухгалтер исправил сумму',
    'idempotency_key', gen_random_uuid()
  ));
  PERFORM _test_assert(
    (v_result ->> 'success')::boolean,
    'WA accountant: ' || COALESCE(v_result ->> 'error', 'ok')
  );
  v_balance := _renter_wallet_balance(v_org, v_renter);
  PERFORM _test_assert(v_balance = 800, 'WA accountant: balance 800, got ' || v_balance);

  SELECT l.created_by INTO v_created_by
  FROM renter_wallet_ledger l
  WHERE l.renter_id = v_renter
    AND l.entry_type = 'wallet_correction_debit'
    AND l.correction_reason = 'бухгалтер исправил сумму';
  PERFORM _test_assert(v_created_by = v_acct_member, 'WA accountant: created_by');

  -- Floor: hold consumes obligated (create hold AFTER topup so apply_wallet does not activate it yet)
  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');
  v_result := staff_renter_wallet_topup(jsonb_build_object(
    'renter_id', v_renter_hold,
    'amount', 2000,
    'method', 'cash',
    'idempotency_key', gen_random_uuid()
  ));
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'WA hold topup: ' || COALESCE(v_result ->> 'error', 'ok'));

  v_d := CURRENT_DATE + 3;
  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle, hold_expires_at,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, currency
  )
  VALUES (
    v_slot_hold, v_org, v_renter_hold, v_loc, v_d, '10:00', '11:00',
    'confirmed', 'miniapp', 'awaiting_payment', now() + interval '20 hours',
    500, 500, 0, 1000, 'RUB'
  );

  v_preview := preview_staff_renter_wallet_adjust(jsonb_build_object(
    'renter_id', v_renter_hold,
    'target_amount', 0
  ));
  PERFORM _test_assert(
    (v_preview ->> 'amount_ok') = 'false',
    'WA hold preview: target 0 not ok'
  );
  PERFORM _test_assert(
    (v_preview ->> 'min_amount')::numeric >= 1000,
    'WA hold preview: min covers full hold, got ' || (v_preview ->> 'min_amount')
  );

  v_result := staff_renter_wallet_adjust(jsonb_build_object(
    'renter_id', v_renter_hold,
    'target_amount', 0,
    'reason', 'попытка обнулить при холде',
    'idempotency_key', gen_random_uuid()
  ));
  PERFORM _test_assert(
    v_result ->> 'error' = 'renter.walletAdjust.belowFloor',
    'WA below floor, got ' || COALESCE(v_result ->> 'error', 'null')
  );

  PERFORM _test_assert(
    member_can_adjust_renter_wallet(),
    'WA owner can adjust'
  );

  RAISE NOTICE 'renter_miniapp_wallet_adjust_test: OK';
END;
$$;

ROLLBACK;
