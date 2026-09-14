-- Staff cashier create for a Mini App renter holds 50% from wallet and
-- worker remainder settles the rest after time_end.
-- Run: npm run test:db:renter-miniapp-staff-cashier-wallet

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
  v_org uuid := 'f9910000-0000-4000-8000-000000000001';
  v_user uuid := 'f9910000-0000-4000-8000-000000000011';
  v_admin uuid := 'f9910000-0000-4000-8000-000000000012';
  v_member uuid := 'f9910000-0000-4000-8000-000000000021';
  v_admin_member uuid := 'f9910000-0000-4000-8000-000000000022';
  v_loc uuid := 'f9910000-0000-4000-8000-000000000031';
  v_renter uuid := 'f9910000-0000-4000-8000-000000000041';
  v_renter_cash uuid := 'f9910000-0000-4000-8000-000000000042';
  v_result jsonb;
  v_id uuid;
  v_paid_id uuid;
  v_cash_id uuid;
  v_short_id uuid;
  v_day date;
  v_life text;
  v_channel text;
  v_tz text;
BEGIN
  SELECT id INTO v_version_id FROM crm_product_versions WHERE code = 'v2';

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES
    (
      v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'staff-wallet-owner@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(),
      '{}'::jsonb, '{}'::jsonb
    ),
    (
      v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'staff-wallet-admin@test.local', crypt('testpass123', gen_salt('bf')), now(), now(), now(),
      '{}'::jsonb, '{}'::jsonb
    )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organizations (id, name, slug, status, crm_version_id, owner_user_id)
  VALUES (v_org, 'Staff Cashier Wallet Org', 'staff-cashier-wallet', 'licensed', v_version_id, v_user)
  ON CONFLICT (id) DO UPDATE SET status = 'licensed', owner_user_id = EXCLUDED.owner_user_id;

  INSERT INTO organization_licenses (organization_id, crm_version_id, license_type, activated_at)
  VALUES (v_org, v_version_id, 'lifetime', now())
  ON CONFLICT (organization_id) DO UPDATE SET license_type = 'lifetime', activated_at = now();

  INSERT INTO organization_members (id, organization_id, user_id, role, display_name)
  VALUES
    (v_member, v_org, v_user, 'owner', 'Owner'),
    (v_admin_member, v_org, v_admin, 'admin', 'Admin')
  ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role;

  INSERT INTO organization_settings (
    organization_id, timezone, currency_code, admin_can_edit_schedule, admin_can_accept_payments
  )
  VALUES (v_org, 'Europe/Moscow', 'RUB', true, true)
  ON CONFLICT (organization_id) DO UPDATE SET
    timezone = EXCLUDED.timezone,
    currency_code = EXCLUDED.currency_code,
    admin_can_edit_schedule = true,
    admin_can_accept_payments = true,
    finance_period_closed_until = NULL;

  INSERT INTO locations (id, organization_id, name, miniapp_enabled)
  VALUES (v_loc, v_org, 'Hall', true)
  ON CONFLICT (id) DO UPDATE SET miniapp_enabled = true;

  INSERT INTO renters (id, organization_id, display_name, status, telegram_id)
  VALUES (v_renter, v_org, 'Mini App Renter', 'active', 99101)
  ON CONFLICT (id) DO UPDATE SET status = 'active', telegram_id = 99101;

  INSERT INTO renters (id, organization_id, display_name, status)
  VALUES (v_renter_cash, v_org, 'Cashier Only', 'active')
  ON CONFLICT (id) DO UPDATE SET status = 'active';

  DELETE FROM rental_payments WHERE organization_id = v_org;
  DELETE FROM rentals WHERE organization_id = v_org;
  DELETE FROM renter_wallet_ledger WHERE organization_id = v_org;

  INSERT INTO renter_wallet_ledger (organization_id, renter_id, entry_type, amount)
  VALUES (v_org, v_renter, 'topup', 2000);

  v_tz := _org_timezone(v_org);
  v_day := (now() AT TIME ZONE v_tz)::date + 7;

  PERFORM _hall_rent_test_set_jwt(v_admin, v_org, v_admin_member, 'admin');

  v_result := create_rental(jsonb_build_object(
    'idempotency_key', 'staff-wallet-hold-' || gen_random_uuid()::text,
    'rental_date', v_day,
    'time_start', '10:00',
    'time_end', '12:00',
    'location_id', v_loc,
    'renter_id', v_renter,
    'fixed_amount', 2000
  ));
  PERFORM _test_assert(COALESCE((v_result ->> 'success')::boolean, false), 'admin create succeeds');
  v_id := (v_result ->> 'rental_id')::uuid;

  SELECT channel, lifecycle INTO v_channel, v_life FROM rentals WHERE id = v_id;
  PERFORM _test_assert(v_channel = 'miniapp', 'cashier create promoted to miniapp');
  PERFORM _test_assert(v_life = 'active', 'FIFO activated 50% reserve');
  PERFORM _test_assert(_renter_wallet_reserved_prepay(v_org, v_renter) = 1000, 'reserved 50%');
  PERFORM _test_assert(_renter_wallet_spendable(v_org, v_renter) = 1000, 'spendable leftover 50%');
  PERFORM _test_assert(_renter_wallet_balance(v_org, v_renter) = 2000, 'wallet not charged yet');
  PERFORM _test_assert(_renter_debt_total(v_renter, v_org) = 0, 'cashier debt ignores miniapp slot');

  UPDATE rentals
  SET
    rental_date = (now() AT TIME ZONE v_tz)::date - 2,
    time_start = '10:00',
    time_end = '11:00'
  WHERE id = v_id;

  PERFORM _renter_expire_and_catchup(v_org, v_renter);
  SELECT lifecycle INTO v_life FROM rentals WHERE id = v_id;
  PERFORM _test_assert(v_life = 'settled', 'remainder after time_end settles the slot');
  PERFORM _test_assert(_renter_wallet_balance(v_org, v_renter) = 0, 'full cost charged from wallet');
  PERFORM _test_assert(_renter_wallet_reserved_prepay(v_org, v_renter) = 0, 'reserve cleared');

  INSERT INTO renter_wallet_ledger (organization_id, renter_id, entry_type, amount)
  VALUES (v_org, v_renter, 'topup', 2000);

  v_result := create_rental(jsonb_build_object(
    'idempotency_key', 'staff-wallet-paid-' || gen_random_uuid()::text,
    'rental_date', v_day + 1,
    'time_start', '12:00',
    'time_end', '14:00',
    'location_id', v_loc,
    'renter_id', v_renter,
    'fixed_amount', 2000,
    'initial_payment', 2000,
    'payment_method', 'cash'
  ));
  PERFORM _test_assert(COALESCE((v_result ->> 'success')::boolean, false), 'paid cashier create succeeds');
  v_paid_id := (v_result ->> 'rental_id')::uuid;
  SELECT channel INTO v_channel FROM rentals WHERE id = v_paid_id;
  PERFORM _test_assert(v_channel = 'cashier', 'cash at create stays cashier');

  v_result := create_rental(jsonb_build_object(
    'idempotency_key', 'staff-wallet-notg-' || gen_random_uuid()::text,
    'rental_date', v_day + 2,
    'time_start', '10:00',
    'time_end', '12:00',
    'location_id', v_loc,
    'renter_id', v_renter_cash,
    'fixed_amount', 1500
  ));
  PERFORM _test_assert(COALESCE((v_result ->> 'success')::boolean, false), 'no-telegram create succeeds');
  v_cash_id := (v_result ->> 'rental_id')::uuid;
  SELECT channel INTO v_channel FROM rentals WHERE id = v_cash_id;
  PERFORM _test_assert(v_channel = 'cashier', 'renter without telegram stays cashier');

  v_result := create_rental(jsonb_build_object(
    'idempotency_key', 'staff-wallet-short-' || gen_random_uuid()::text,
    'rental_date', v_day + 3,
    'time_start', '16:00',
    'time_end', '18:00',
    'location_id', v_loc,
    'renter_id', v_renter,
    'fixed_amount', 5000
  ));
  PERFORM _test_assert(COALESCE((v_result ->> 'success')::boolean, false), 'short wallet create succeeds');
  v_short_id := (v_result ->> 'rental_id')::uuid;
  SELECT channel, lifecycle INTO v_channel, v_life FROM rentals WHERE id = v_short_id;
  PERFORM _test_assert(v_channel = 'miniapp', 'not enough wallet still promotes to miniapp');
  PERFORM _test_assert(v_life = 'debt', 'not enough wallet becomes Mini App debt');
  PERFORM _test_assert(_renter_wallet_debt_outstanding(v_org, v_renter) = 5000, 'Mini App debt is full cost');
  PERFORM _test_assert(_renter_debt_total(v_renter, v_org) = 0, 'cashier debt ignores miniapp unpaid');

  v_result := renter_delete_hold(v_short_id);
  PERFORM _test_assert(COALESCE((v_result ->> 'success')::boolean, false), 'staff can release unpaid Mini App debt before start');
  PERFORM _test_assert(
    (SELECT booking_status FROM rentals WHERE id = v_short_id) = 'cancelled',
    'released debt slot is cancelled'
  );
  PERFORM _test_assert(
    NOT _renter_location_slot_busy(v_org, v_day + 3, '16:00', '18:00', v_loc),
    'released slot is free for a new rental'
  );

  v_result := preview_rental_conflicts(v_day + 3, '16:00', '18:00', v_loc);
  PERFORM _test_assert(COALESCE((v_result ->> 'success')::boolean, false), 'preview after release succeeds');
  PERFORM _test_assert(
    jsonb_array_length(COALESCE(v_result -> 'conflicts', '[]'::jsonb)) = 0,
    'preview has no leftover hold after release'
  );

  v_result := create_rental(jsonb_build_object(
    'idempotency_key', 'staff-wallet-recreate-' || gen_random_uuid()::text,
    'rental_date', v_day + 3,
    'time_start', '16:00',
    'time_end', '18:00',
    'location_id', v_loc,
    'renter_id', v_renter,
    'fixed_amount', 5000
  ));
  PERFORM _test_assert(COALESCE((v_result ->> 'success')::boolean, false), 'recreate after released debt succeeds');
  SELECT channel, lifecycle INTO v_channel, v_life FROM rentals WHERE id = (v_result ->> 'rental_id')::uuid;
  PERFORM _test_assert(v_channel = 'miniapp' AND v_life = 'debt', 'recreate with short wallet is Mini App debt again');
END;
$$;

ROLLBACK;
