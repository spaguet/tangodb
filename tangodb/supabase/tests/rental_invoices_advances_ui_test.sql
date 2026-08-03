-- rental invoices/advances UI (hall rent stage 10)
-- Run: psql $DATABASE_URL -f supabase/tests/rental_invoices_advances_ui_test.sql

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
  v_org uuid := 'ffffffff-ffff-ffff-ffff-fffffffffff2';
  v_renter uuid := 'ffffffff-ffff-ffff-ffff-000000000312';
  v_result jsonb;
  v_report jsonb;
BEGIN
  -- Uses seed data from rental_money_register_test (same org/renter)
  v_result := get_rental_accrual_report('2026-01-01'::date, '2099-12-31'::date, v_renter);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'get_rental_accrual_report success');
  v_report := v_result -> 'report';
  PERFORM _test_assert(v_report ? 'accrued_amount', 'report has accrued_amount');
  PERFORM _test_assert(v_report ? 'paid_total', 'report has paid_total');
  PERFORM _test_assert(v_report ? 'advances_received', 'report has advances_received');
  PERFORM _test_assert(v_report ? 'total_debt', 'report has total_debt');

  v_result := list_renter_rental_advances(v_renter);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'list_renter_rental_advances success');

  v_result := list_renter_rental_advance_allocations(v_renter);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'list_renter_rental_advance_allocations success');

  v_result := get_rental_accrual_report('2099-01-01'::date, '2098-12-31'::date, NULL);
  PERFORM _test_assert(NOT (v_result ->> 'success')::boolean, 'invalid period rejected');
END;
$$;

ROLLBACK;
