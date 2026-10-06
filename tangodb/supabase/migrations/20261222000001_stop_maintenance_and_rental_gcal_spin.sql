-- Stop the renter-booking-worker hot loop and rental calendar enqueue on every UPDATE.
-- Staff Mini App slots stay lifecycle=active until start (20261127000001) and were
-- re-claimed for the whole T-24 window. Calendar sync fired on updated_at / wallet writes.

BEGIN;

-- Coarse date filter in the claim can use this; timezone checks stay in _renter_slot_ts.
CREATE INDEX IF NOT EXISTS idx_rentals_miniapp_lifecycle_date
  ON rentals (lifecycle, rental_date)
  WHERE channel = 'miniapp';

CREATE INDEX IF NOT EXISTS idx_rentals_miniapp_awaiting_hold
  ON rentals (hold_expires_at)
  WHERE channel = 'miniapp' AND lifecycle = 'awaiting_payment';

-- Set of renters the maintenance worker should touch. Staff active slots before
-- start are reserved on purpose and are not due.
CREATE OR REPLACE FUNCTION renter_booking_maintenance_due_pairs()
RETURNS TABLE (organization_id uuid, renter_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT r.organization_id, r.renter_id
  FROM rentals r
  WHERE r.channel = 'miniapp'
    AND (
      (
        r.lifecycle = 'awaiting_payment'
        AND (
          (r.hold_expires_at IS NOT NULL AND r.hold_expires_at <= now())
          OR _renter_slot_ts(r.organization_id, r.rental_date, r.time_start) <= now()
        )
      )
      OR (
        r.lifecycle = 'active'
        AND r.rental_date <= (CURRENT_DATE + 3)
        AND (
          (
            r.created_by IS NULL
            AND _renter_slot_ts(r.organization_id, r.rental_date, r.time_start) > now()
            AND _renter_slot_ts(r.organization_id, r.rental_date, r.time_start) - interval '24 hours' <= now()
          )
          OR _renter_slot_ts(r.organization_id, r.rental_date, r.time_start) <= now()
        )
      )
      OR (
        r.lifecycle = 'prepaid_charged'
        AND r.rental_date <= (CURRENT_DATE + 2)
        AND _renter_slot_ts(r.organization_id, r.rental_date, r.time_end) <= now()
      )
    );
$$;

COMMENT ON FUNCTION renter_booking_maintenance_due_pairs() IS
  'Renters with Mini App work due now. Staff active slots before start are excluded.';

REVOKE ALL ON FUNCTION renter_booking_maintenance_due_pairs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION renter_booking_maintenance_due_pairs() TO service_role;

CREATE OR REPLACE FUNCTION claim_renter_booking_maintenance(p_batch_size integer DEFAULT 20)
RETURNS TABLE (organization_id uuid, renter_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_batch_size IS NULL OR p_batch_size < 1 OR p_batch_size > 100 THEN
    RAISE EXCEPTION 'invalid_batch_size';
  END IF;

  RETURN QUERY
  WITH due AS (
    SELECT d.organization_id, d.renter_id
    FROM renter_booking_maintenance_due_pairs() d
  ),
  picked AS (
    SELECT rt.organization_id, rt.id AS renter_id
    FROM renters rt
    INNER JOIN due d
      ON d.renter_id = rt.id
     AND d.organization_id = rt.organization_id
    ORDER BY rt.organization_id, rt.id
    LIMIT p_batch_size
    FOR UPDATE OF rt SKIP LOCKED
  )
  SELECT picked.organization_id, picked.renter_id
  FROM picked;
END;
$$;

COMMENT ON FUNCTION claim_renter_booking_maintenance(integer) IS
  'Renters with unfinished Mini App work. Staff active-before-start slots are not due.';

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
  v_still integer := 0;
  v_extra jsonb;
  v_failures jsonb := '[]'::jsonb;
  v_err_message text;
  v_err_state text;
  v_orgs uuid[] := ARRAY[]::uuid[];
  v_renters uuid[] := ARRAY[]::uuid[];
  v_progressed boolean := false;
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
      v_orgs := array_append(v_orgs, v_row.organization_id);
      v_renters := array_append(v_renters, v_row.renter_id);
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
        IF v_failed <= 3 THEN
          v_failures := v_failures || jsonb_build_array(
            jsonb_build_object(
              'organization_id', v_row.organization_id,
              'renter_id', v_row.renter_id,
              'error', left(COALESCE(v_err_message, ''), 200),
              'sqlstate', left(COALESCE(v_err_state, ''), 10)
            )
          );
        END IF;
    END;
  END LOOP;

  IF v_n > 0 THEN
    SELECT count(*)::integer
    INTO v_still
    FROM renter_booking_maintenance_due_pairs() d
    WHERE (d.organization_id, d.renter_id) IN (
      SELECT u.organization_id, u.renter_id
      FROM unnest(v_orgs, v_renters) AS u(organization_id, renter_id)
    );
    v_progressed := v_still < v_n;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'processed', v_n,
    'failed', v_failed,
    'failures', v_failures,
    'progressed', v_progressed
  );
END;
$$;

COMMENT ON FUNCTION run_renter_booking_maintenance(integer) IS
  'Claim due renters and run expire/catch-up. progressed=false when every renter is still due.';

-- Google event uses date, times, status, purpose, hall, renter. Wallet and updated_at do not.
CREATE OR REPLACE FUNCTION rentals_calendar_sync_enqueue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_calendar_changed boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.booking_status = 'confirmed' THEN
      PERFORM enqueue_calendar_sync(
        NEW.organization_id,
        'rental',
        NEW.id,
        NEW.rental_date,
        'upsert'
      );
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_calendar_changed :=
      OLD.rental_date IS DISTINCT FROM NEW.rental_date
      OR OLD.time_start IS DISTINCT FROM NEW.time_start
      OR OLD.time_end IS DISTINCT FROM NEW.time_end
      OR OLD.booking_status IS DISTINCT FROM NEW.booking_status
      OR OLD.purpose IS DISTINCT FROM NEW.purpose
      OR OLD.location_id IS DISTINCT FROM NEW.location_id
      OR OLD.renter_id IS DISTINCT FROM NEW.renter_id;

    IF NOT v_calendar_changed THEN
      RETURN NEW;
    END IF;

    IF OLD.rental_date IS DISTINCT FROM NEW.rental_date
       AND OLD.booking_status = 'confirmed' THEN
      PERFORM enqueue_calendar_sync(
        OLD.organization_id,
        'rental',
        OLD.id,
        OLD.rental_date,
        'delete'
      );
    END IF;

    IF NEW.booking_status = 'confirmed' THEN
      PERFORM enqueue_calendar_sync(
        NEW.organization_id,
        'rental',
        NEW.id,
        NEW.rental_date,
        'upsert'
      );
    ELSIF OLD.booking_status = 'confirmed' THEN
      PERFORM enqueue_calendar_sync(
        NEW.organization_id,
        'rental',
        NEW.id,
        NEW.rental_date,
        'delete'
      );
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM enqueue_calendar_sync(
      OLD.organization_id,
      'rental',
      OLD.id,
      OLD.rental_date,
      'delete'
    );
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS rentals_calendar_sync_after_iu_trg ON rentals;
DROP TRIGGER IF EXISTS rentals_calendar_sync_after_insert_trg ON rentals;
DROP TRIGGER IF EXISTS rentals_calendar_sync_after_update_trg ON rentals;

CREATE TRIGGER rentals_calendar_sync_after_insert_trg
  AFTER INSERT ON rentals
  FOR EACH ROW
  EXECUTE FUNCTION rentals_calendar_sync_enqueue();

CREATE TRIGGER rentals_calendar_sync_after_update_trg
  AFTER UPDATE OF rental_date, time_start, time_end, booking_status, purpose, location_id, renter_id
  ON rentals
  FOR EACH ROW
  EXECUTE FUNCTION rentals_calendar_sync_enqueue();

COMMIT;
