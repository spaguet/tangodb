-- R1b: wallet ledger helpers, leftover-advance backfill, currency/allocate guards.
-- Run: psql "%DATABASE_URL%" -v ON_ERROR_STOP=1 -f supabase/tests/_hall_rent_test_jwt.sql -f supabase/tests/renter_miniapp_r1b_wallet_ledger_test.sql

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
  v_org uuid := 'a1b00000-0000-4000-8000-000000000001';
  v_org_b uuid := 'a1b00000-0000-4000-8000-00000000000b';
  v_user uuid := 'a1b00000-0000-4000-8000-000000000011';
  v_user_b uuid := 'a1b00000-0000-4000-8000-000000000012';
  v_member uuid := 'a1b00000-0000-4000-8000-000000000021';
  v_member_b uuid := 'a1b00000-0000-4000-8000-000000000022';
  v_loc uuid := 'a1b00000-0000-4000-8000-000000000031';
  v_renter_a uuid := 'a1b00000-0000-4000-8000-000000000041';
  v_renter_b uuid := 'a1b00000-0000-4000-8000-000000000042';
  v_renter_c uuid := 'a1b00000-0000-4000-8000-000000000043';
  v_advance_a uuid := 'a1b00000-0000-4000-8000-000000000061';
  v_advance_fresh uuid := 'a1b00000-0000-4000-8000-000000000062';
  v_invoice uuid := 'a1b00000-0000-4000-8000-000000000071';
  v_debt_rental uuid := 'a1b00000-0000-4000-8000-000000000081';
  v_active_rental uuid := 'a1b00000-0000-4000-8000-000000000082';
  v_inflow_before numeric;
  v_inflow_after numeric;
  v_reg_count_before integer;
  v_reg_count_after integer;
  v_adv_count_before integer;
  v_backfill_n integer;
  v_result jsonb;
  v_raised boolean;
  v_def text;
  v_key_a bigint;
  v_key_b bigint;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES
    (
      v_user,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'r1b-owner@test.local',
      crypt('testpass123', gen_salt('bf')),
      now(), now(), now(),
      '{}'::jsonb,
      '{}'::jsonb
    ),
    (
      v_user_b,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'r1b-owner-b@test.local',
      crypt('testpass123', gen_salt('bf')),
      now(), now(), now(),
      '{}'::jsonb,
      '{}'::jsonb
    )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES
    (v_org, 'R1b Wallet Org', 'r1b-wallet-a', 'licensed', v_version_id, v_user),
    (v_org_b, 'R1b Wallet Org B', 'r1b-wallet-b', 'licensed', v_version_id, v_user_b)
  ON CONFLICT (id) DO UPDATE SET
    status = 'licensed',
    owner_user_id = EXCLUDED.owner_user_id;

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES
    (v_org, v_version_id, 'lifetime', now()),
    (v_org_b, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET
    license_type = 'lifetime',
    activated_at = now();

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES
    (v_member, v_org, v_user, 'owner', 'R1b Owner'),
    (v_member_b, v_org_b, v_user_b, 'owner', 'R1b Owner B')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO organization_settings (organization_id, timezone, currency_code)
  VALUES
    (v_org, 'Europe/Moscow', 'RUB'),
    (v_org_b, 'Europe/Moscow', 'RUB')
  ON CONFLICT (organization_id) DO UPDATE SET
    timezone = EXCLUDED.timezone,
    currency_code = EXCLUDED.currency_code,
    finance_period_closed_until = NULL;

  INSERT INTO locations (id, organization_id, name)
  VALUES (v_loc, v_org, 'R1b Hall')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO renters (id, organization_id, display_name)
  VALUES
    (v_renter_a, v_org, 'R1b Renter A'),
    (v_renter_b, v_org, 'R1b Renter B'),
    (v_renter_c, v_org_b, 'R1b Renter C')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO rental_advances (
    id, organization_id, renter_id, amount, allocated_amount, method, created_by
  )
  VALUES (v_advance_a, v_org, v_renter_a, 1000, 0, 'cash', v_member);

  SELECT COALESCE(SUM(signed_amount), 0), count(*)
  INTO v_inflow_before, v_reg_count_before
  FROM rental_money_register_v
  WHERE organization_id = v_org;

  SELECT count(*) INTO v_adv_count_before
  FROM rental_advances
  WHERE organization_id = v_org;

  v_backfill_n := _renter_wallet_backfill_unallocated_advances();
  PERFORM _test_assert(v_backfill_n >= 1, 'backfill transferred at least the leftover advance');

  SELECT COALESCE(SUM(signed_amount), 0), count(*)
  INTO v_inflow_after, v_reg_count_after
  FROM rental_money_register_v
  WHERE organization_id = v_org;

  PERFORM _test_assert(
    v_inflow_after = v_inflow_before,
    'backfill does not increase rental_money_register_v inflow'
  );
  PERFORM _test_assert(
    v_reg_count_after = v_reg_count_before,
    'backfill does not add a register row'
  );
  PERFORM _test_assert(
    (SELECT count(*) FROM rental_advances WHERE organization_id = v_org) = v_adv_count_before,
    'backfill does not insert a new rental_advances row'
  );
  PERFORM _test_assert(
    (SELECT allocated_amount FROM rental_advances WHERE id = v_advance_a) = 1000,
    'leftover advance is fully allocated after transfer'
  );
  PERFORM _test_assert(
    (
      SELECT count(*) FROM renter_wallet_ledger
      WHERE advance_id = v_advance_a AND entry_type = 'topup' AND amount = 1000
    ) = 1,
    'one ledger topup for transferred remainder'
  );

  PERFORM _test_assert(
    _renter_wallet_backfill_unallocated_advances() = 0
      OR (
        SELECT count(*) FROM renter_wallet_ledger
        WHERE advance_id = v_advance_a AND entry_type = 'topup'
      ) = 1,
    'second backfill does not duplicate ledger topup'
  );
  PERFORM _test_assert(
    (
      SELECT count(*) FROM renter_wallet_ledger
      WHERE advance_id = v_advance_a AND entry_type = 'topup'
    ) = 1,
    'exactly one topup row after idempotent backfill'
  );

  PERFORM _test_assert(
    _renter_wallet_balance(v_org, v_renter_a) = 1000,
    'wallet_balance is ledger topup'
  );
  PERFORM _test_assert(
    _renter_wallet_reserved_prepay(v_org, v_renter_a) = 0,
    'reserved_prepay is 0 without active Mini App slots'
  );
  PERFORM _test_assert(
    _renter_wallet_spendable(v_org, v_renter_a) = 1000,
    'spendable equals wallet when nothing reserved'
  );
  PERFORM _test_assert(
    _renter_wallet_available(v_org, v_renter_a) = 1000,
    'available equals spendable when no Mini App debt'
  );

  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');

  INSERT INTO rental_invoices (
    id, organization_id, renter_id, period_start, period_end, due_date,
    status, total_amount, currency, created_by
  )
  VALUES (
    v_invoice, v_org, v_renter_a, current_date, current_date + 30, current_date + 14,
    'invoiced', 5000, 'RUB', v_member
  );

  v_result := allocate_rental_advance(v_advance_a, v_invoice, 100);
  PERFORM _test_assert(
    (v_result ->> 'success')::boolean IS NOT TRUE
      AND v_result ->> 'error' = 'rental.advance.insufficient',
    'backfill leftover cannot be allocated again onto a 2.5 invoice'
  );

  INSERT INTO rental_advances (
    id, organization_id, renter_id, amount, allocated_amount, method, created_by
  )
  VALUES (v_advance_fresh, v_org, v_renter_a, 500, 0, 'transfer', v_member);

  v_result := allocate_rental_advance(v_advance_fresh, v_invoice, 200);
  PERFORM _test_assert(
    (v_result ->> 'success')::boolean IS TRUE,
    'cashier 2.5 allocate still works on an advance that was never transferred to the wallet'
  );

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, fixed_amount, currency, channel, lifecycle,
    prepay_amount, remainder_amount, debt_amount
  )
  VALUES (
    v_debt_rental, v_org, v_renter_a, v_loc, current_date - 2, '10:00', '12:00',
    'confirmed', 2000, 'RUB', 'miniapp', 'debt',
    1000, 1000, 80
  );

  PERFORM _test_assert(
    _renter_wallet_debt_outstanding(v_org, v_renter_a) = 80,
    'debt_outstanding sums Mini App debt_amount'
  );
  PERFORM _test_assert(
    _renter_wallet_spendable(v_org, v_renter_a) = 1000,
    'spendable stays positive when only debt exists'
  );
  PERFORM _test_assert(
    _renter_wallet_available(v_org, v_renter_a) = 0,
    'available is 0 while Mini App debt_amount > 0'
  );

  INSERT INTO renter_wallet_ledger (
    organization_id, renter_id, entry_type, amount
  )
  VALUES (v_org, v_renter_b, 'topup', 100);

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, fixed_amount, currency, channel, lifecycle,
    prepay_amount, remainder_amount, debt_amount, prepay_charged_at
  )
  VALUES (
    v_active_rental, v_org, v_renter_b, v_loc, current_date + 8, '18:00', '20:00',
    'confirmed', 500, 'RUB', 'miniapp', 'active',
    250, 250, 0, NULL
  );

  PERFORM _test_assert(
    _renter_wallet_balance(v_org, v_renter_b) = 100,
    'renter B wallet_balance'
  );
  PERFORM _test_assert(
    _renter_wallet_reserved_prepay(v_org, v_renter_b) = 250,
    'reserved_prepay from active uncharged slot'
  );
  PERFORM _test_assert(
    _renter_wallet_spendable(v_org, v_renter_b) = 0,
    'spendable is never negative when reserved > wallet'
  );
  PERFORM _test_assert(
    _renter_wallet_available(v_org, v_renter_b) = 0,
    'available follows spendable when no debt'
  );

  INSERT INTO renter_wallet_ledger (
    organization_id, renter_id, entry_type, amount
  )
  VALUES (v_org_b, v_renter_c, 'topup', 50);

  v_raised := false;
  BEGIN
    UPDATE organization_settings
    SET currency_code = 'USD'
    WHERE organization_id = v_org_b;
  EXCEPTION WHEN check_violation OR OTHERS THEN
    v_raised := true;
  END;
  PERFORM _test_assert(v_raised, 'currency change with non-zero ledger rejected');

  PERFORM _test_assert(
    (SELECT currency_code FROM organization_settings WHERE organization_id = v_org_b) = 'RUB',
    'currency_code unchanged after rejected update'
  );

  v_def := pg_get_functiondef('public._renter_wallet_lock_key(uuid,uuid)'::regprocedure);
  PERFORM _test_assert(v_def ILIKE '%md5%', 'wallet lock key uses md5');
  PERFORM _test_assert(v_def LIKE '%:renter_wallet%', 'wallet lock key uses :renter_wallet suffix');
  PERFORM _test_assert(v_def NOT ILIKE '%hashtext%', 'wallet lock key does not use hashtext');

  v_key_a := _renter_wallet_lock_key(v_org, v_renter_a);
  v_key_b := _renter_wallet_lock_key(v_org, v_renter_b);
  PERFORM _test_assert(v_key_a = _renter_wallet_lock_key(v_org, v_renter_a), 'lock key is stable');
  PERFORM _test_assert(v_key_a <> v_key_b, 'lock key differs per renter');

  PERFORM _test_assert(
    NOT has_table_privilege('authenticated', 'renter_wallet_ledger', 'SELECT'),
    'no GRANT SELECT authenticated on ledger'
  );
  PERFORM _test_assert(
    NOT has_table_privilege('anon', 'renter_wallet_ledger', 'SELECT'),
    'no GRANT SELECT anon on ledger'
  );
  PERFORM _test_assert(
    pg_get_viewdef('public.rental_money_register_v'::regclass) NOT ILIKE '%renter_wallet_ledger%',
    'register view has no ledger UNION'
  );

  RAISE NOTICE 'renter_miniapp_r1b_wallet_ledger_test: OK';
END;
$$;

ROLLBACK;
