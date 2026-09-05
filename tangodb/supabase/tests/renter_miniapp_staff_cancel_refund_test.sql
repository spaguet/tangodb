-- Staff CRM cancel returns prepay_charge to renter wallet.
-- Run: psql "%DATABASE_URL%" -f supabase/tests/renter_miniapp_staff_cancel_refund_test.sql

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
  v_org uuid := 'a1c00000-0000-4000-8000-000000000001';
  v_renter uuid := 'a1c00000-0000-4000-8000-000000000901';
  v_member uuid := 'a1c00000-0000-4000-8000-000000000002';
  v_user uuid := 'a1c00000-0000-4000-8000-000000000003';
  v_loc uuid := 'a1c00000-0000-4000-8000-000000000010';
  v_rental uuid := 'a1c00000-0000-4000-8000-000000000902';
  v_far date := (current_date + 5);
  v_balance_before numeric;
  v_balance_after numeric;
  v_result jsonb;
BEGIN
  PERFORM _hall_rent_test_set_jwt(v_user, v_org, v_member, 'owner');

  DELETE FROM renter_wallet_ledger WHERE organization_id = v_org AND renter_id = v_renter;
  DELETE FROM rentals WHERE id = v_rental;

  INSERT INTO renter_wallet_ledger (organization_id, renter_id, entry_type, amount)
  VALUES (v_org, v_renter, 'topup', 2000);

  INSERT INTO rentals (
    id, organization_id, renter_id, location_id, rental_date, time_start, time_end,
    booking_status, channel, lifecycle,
    prepay_amount, remainder_amount, debt_amount, fixed_amount, calculated_amount, currency,
    prepay_charged_at
  )
  VALUES (
    v_rental, v_org, v_renter, v_loc, v_far, '18:00', '19:00',
    'confirmed', 'miniapp', 'prepaid_charged',
    500, 500, 0, 1000, 1000, 'RUB',
    now() - interval '2 hours'
  );

  INSERT INTO renter_wallet_ledger (
    organization_id, renter_id, entry_type, amount, rental_id, phase
  )
  VALUES (v_org, v_renter, 'prepay_charge', 500, v_rental, 'prepay');

  v_balance_before := _renter_wallet_balance(v_org, v_renter);
  PERFORM _test_assert(v_balance_before = 1500, 'fixture balance before staff cancel');

  v_result := renter_cancel_occurrence(v_rental);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'staff cancel succeeds: ' || COALESCE(v_result ->> 'error', 'ok'));
  PERFORM _test_assert(
    v_result ->> 'reason' = 'miniapp_staff_cancel_refund',
    'staff cancel reason is full refund'
  );

  v_balance_after := _renter_wallet_balance(v_org, v_renter);
  PERFORM _test_assert(
    v_balance_after = 2000,
    'wallet balance restored after staff cancel (got ' || v_balance_after || ')'
  );

  RAISE NOTICE 'renter_miniapp_staff_cancel_refund_test: all assertions passed';
END;
$$;

ROLLBACK;
