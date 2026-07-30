-- Payment and attendance corrections (CRM scenario 10)

\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION _test_assert(cond boolean, msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT cond THEN
    RAISE EXCEPTION 'ASSERT FAILED: %', msg;
  END IF;
END;
$$;

DO $$
DECLARE
  v_org uuid := '00000000-0000-4000-8000-000000000001';
  v_sub uuid;
  v_payment uuid;
  v_key uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  v_result jsonb;
  v_result2 jsonb;
  v_storno jsonb;
  v_remaining numeric;
BEGIN
  SELECT id INTO v_sub
  FROM subscriptions
  WHERE organization_id = v_org
  LIMIT 1;

  PERFORM _test_assert(v_sub IS NOT NULL, 'subscription fixture must exist');

  v_result := record_subscription_payment(v_sub, 5000, 'cash', NULL, v_key);
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'first payment with idempotency');
  v_payment := (v_result ->> 'payment_id')::uuid;

  v_result2 := record_subscription_payment(v_sub, 5000, 'cash', NULL, v_key);
  PERFORM _test_assert((v_result2 ->> 'success')::boolean, 'idempotent replay succeeds');
  PERFORM _test_assert((v_result2 ->> 'payment_id')::uuid = v_payment, 'same payment id on replay');
  PERFORM _test_assert((v_result2 ->> 'already_applied')::boolean, 'already_applied flag');

  v_result2 := record_subscription_payment(v_sub, 6000, 'cash', NULL, v_key);
  PERFORM _test_assert((v_result2 ->> 'error_code') = 'idempotency_conflict', 'conflict on changed payload');

  v_storno := storno_payment(v_payment, NULL, 'duplicate', 'test duplicate', gen_random_uuid());
  PERFORM _test_assert((v_storno ->> 'success')::boolean, 'storno succeeds');

  v_remaining := payment_remaining_amount(v_org, v_payment);
  PERFORM _test_assert(v_remaining = 0, 'remaining zero after full storno');

  v_storno := storno_payment(v_payment, NULL, 'duplicate', 'again', gen_random_uuid());
  PERFORM _test_assert(NOT (v_storno ->> 'success')::boolean, 'second full storno rejected');
END;
$$;

ROLLBACK;
