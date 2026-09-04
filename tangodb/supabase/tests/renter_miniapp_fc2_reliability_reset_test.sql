-- FC2: reliability reset requires reason and writes audit row.
-- Run after r5_reliability_test JWT setup.

DO $$
DECLARE
  v_org uuid;
  v_renter uuid;
  v_result jsonb;
  v_audit integer;
BEGIN
  SELECT organization_id, id INTO v_org, v_renter
  FROM renters
  WHERE display_name = 'R5 Reliability Renter'
  LIMIT 1;

  IF v_renter IS NULL THEN
    RAISE NOTICE 'renter_miniapp_fc2_reliability_reset_test: SKIP (run r5 test first)';
    RETURN;
  END IF;

  v_result := reset_renter_reliability(v_renter, NULL);
  PERFORM _test_assert(
    (v_result ->> 'success')::boolean IS DISTINCT FROM true
      AND v_result ->> 'error' = 'renters.error.reliabilityResetReasonRequired',
    'reset without reason rejected'
  );

  v_result := reset_renter_reliability(v_renter, 'ab');
  PERFORM _test_assert(
    (v_result ->> 'success')::boolean IS DISTINCT FROM true,
    'reset with short reason rejected'
  );

  UPDATE renters
  SET on_time_count = 2, untimely_count = 3, booking_banned_at = now()
  WHERE id = v_renter;

  v_result := reset_renter_reliability(v_renter, 'Appeal approved by director');
  PERFORM _test_assert((v_result ->> 'success')::boolean, 'reset with reason succeeds');

  SELECT count(*) INTO v_audit
  FROM renter_reliability_reset_audit
  WHERE renter_id = v_renter
    AND reason = 'Appeal approved by director'
    AND on_time_before = 2
    AND untimely_before = 3;

  PERFORM _test_assert(v_audit = 1, 'audit row stored with before snapshot');

  RAISE NOTICE 'renter_miniapp_fc2_reliability_reset_test: OK';
END;
$$;
