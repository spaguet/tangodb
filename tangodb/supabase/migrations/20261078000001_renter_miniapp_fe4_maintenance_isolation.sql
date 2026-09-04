-- FE4 / 2.9.60: per-renter isolation in maintenance batch; retryable failure ledger.

BEGIN;

-- =============================================================================
-- 1. Retryable failure ledger (per org + renter)
-- =============================================================================

CREATE TABLE IF NOT EXISTS renter_booking_maintenance_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  renter_id uuid NOT NULL REFERENCES renters(id) ON DELETE CASCADE,
  rental_series_id uuid REFERENCES rental_series(id) ON DELETE SET NULL,
  error_message text NOT NULL,
  sqlstate text,
  fail_count integer NOT NULL DEFAULT 1,
  first_failed_at timestamptz NOT NULL DEFAULT now(),
  last_failed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT renter_booking_maintenance_failures_org_renter_uniq
    UNIQUE (organization_id, renter_id),
  CONSTRAINT renter_booking_maintenance_failures_fail_count_chk
    CHECK (fail_count >= 1)
);

COMMENT ON TABLE renter_booking_maintenance_failures IS
  'FE4: retryable maintenance failures per renter; cleared on next successful tick.';

CREATE INDEX IF NOT EXISTS idx_renter_booking_maintenance_failures_last_failed
  ON renter_booking_maintenance_failures (last_failed_at DESC);

REVOKE ALL ON TABLE renter_booking_maintenance_failures FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE renter_booking_maintenance_failures TO service_role;

-- =============================================================================
-- 2. Failure helpers
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_record_maintenance_failure(
  p_org_id uuid,
  p_renter_id uuid,
  p_series_id uuid,
  p_message text,
  p_sqlstate text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO renter_booking_maintenance_failures (
    organization_id, renter_id, rental_series_id, error_message, sqlstate
  )
  VALUES (
    p_org_id,
    p_renter_id,
    p_series_id,
    left(COALESCE(p_message, 'unknown'), 2000),
    NULLIF(left(COALESCE(p_sqlstate, ''), 10), '')
  )
  ON CONFLICT ON CONSTRAINT renter_booking_maintenance_failures_org_renter_uniq
  DO UPDATE SET
    rental_series_id = COALESCE(EXCLUDED.rental_series_id, renter_booking_maintenance_failures.rental_series_id),
    error_message = EXCLUDED.error_message,
    sqlstate = EXCLUDED.sqlstate,
    fail_count = renter_booking_maintenance_failures.fail_count + 1,
    last_failed_at = now();
END;
$$;

COMMENT ON FUNCTION _renter_record_maintenance_failure(uuid, uuid, uuid, text, text) IS
  'FE4: upsert retryable maintenance failure for a renter.';

CREATE OR REPLACE FUNCTION _renter_clear_maintenance_failure(p_org_id uuid, p_renter_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM renter_booking_maintenance_failures
  WHERE organization_id = p_org_id
    AND renter_id = p_renter_id;
END;
$$;

COMMENT ON FUNCTION _renter_clear_maintenance_failure(uuid, uuid) IS
  'FE4: clear maintenance failure row after successful renter tick.';

-- =============================================================================
-- 3. Worker — isolate per renter; partial batch result
-- =============================================================================

CREATE OR REPLACE FUNCTION run_renter_booking_maintenance(p_batch_size integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row record;
  v_n integer := 0;
  v_failed integer := 0;
  v_extra jsonb;
  v_failures jsonb := '[]'::jsonb;
  v_err_message text;
  v_err_state text;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size < 1 OR p_batch_size > 100 THEN
    RAISE EXCEPTION 'invalid_batch_size';
  END IF;

  FOR v_row IN
    SELECT c.organization_id, c.renter_id
    FROM claim_renter_booking_maintenance(p_batch_size) c
  LOOP
    BEGIN
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object('location_id', r.location_id, 'date', r.rental_date)
          ORDER BY r.location_id, r.rental_date
        ),
        '[]'::jsonb
      )
      INTO v_extra
      FROM rentals r
      WHERE r.organization_id = v_row.organization_id
        AND r.renter_id = v_row.renter_id
        AND r.channel = 'miniapp'
        AND r.lifecycle IN ('active', 'prepaid_charged');

      PERFORM _renter_acquire_miniapp_locks(v_row.organization_id, v_row.renter_id, v_extra);
      PERFORM _renter_expire_and_catchup(v_row.organization_id, v_row.renter_id);
      PERFORM _renter_clear_maintenance_failure(v_row.organization_id, v_row.renter_id);
      v_n := v_n + 1;
    EXCEPTION
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS
          v_err_message = MESSAGE_TEXT,
          v_err_state = RETURNED_SQLSTATE;
        PERFORM _renter_record_maintenance_failure(
          v_row.organization_id,
          v_row.renter_id,
          NULL,
          v_err_message,
          v_err_state
        );
        v_failed := v_failed + 1;
        v_failures := v_failures || jsonb_build_array(
          jsonb_build_object(
            'organization_id', v_row.organization_id,
            'renter_id', v_row.renter_id,
            'error', v_err_message,
            'sqlstate', v_err_state
          )
        );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'processed', v_n,
    'failed', v_failed,
    'failures', v_failures
  );
END;
$$;

COMMENT ON FUNCTION run_renter_booking_maintenance(integer) IS
  'R1d/R4/FE4: claim renters, lock, expire/catch-up/FIFO. Per-renter isolation; partial batch result.';

REVOKE ALL ON FUNCTION _renter_record_maintenance_failure(uuid, uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_clear_maintenance_failure(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION _renter_record_maintenance_failure(uuid, uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_clear_maintenance_failure(uuid, uuid) TO service_role;

COMMIT;
