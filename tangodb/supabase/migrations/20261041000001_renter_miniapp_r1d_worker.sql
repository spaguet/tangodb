-- R1d / 2.9.4: Mini App booking worker — claim by renter, tick R1c helpers, drain stub.
-- Does not copy §4.1 into Edge. untimely++ stays in _renter_apply_reliability (no-op until R5).

BEGIN;

-- =============================================================================
-- Extra partial index (R1c already has hold_expires / time_start / unfinished)
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_rentals_miniapp_time_end
  ON rentals (organization_id, rental_date, time_end)
  WHERE channel = 'miniapp'
    AND lifecycle IN ('active', 'prepaid_charged');

-- =============================================================================
-- Reliability allow-flag (stub still no-ops; R5 reads p_allowed)
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_reliability_tick_allowed(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT organization_allows_writes(p_org_id)
    AND renter_miniapp_addon_is_active(p_org_id)
    AND NOT _is_finance_period_closed(p_org_id, _org_local_date(p_org_id));
$$;

COMMENT ON FUNCTION _renter_reliability_tick_allowed(uuid) IS
  'R1d: AND of writes + add-on + open finance period. Passed to apply_reliability; increment remains no-op until R5.';

CREATE OR REPLACE FUNCTION _renter_apply_reliability(
  p_rental_id uuid,
  p_phase text,
  p_allowed boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- R1d stub: no on_time++/untimely++. R5 replaces this body in-place (same name).
  -- p_allowed already encodes writes ∧ add-on ∧ period-open.
  RETURN;
END;
$$;

COMMENT ON FUNCTION _renter_apply_reliability(uuid, text, boolean) IS
  'R1d stub (always no-op). Callers pass _renter_reliability_tick_allowed. R5 replaces the body; keep the name.';

CREATE OR REPLACE FUNCTION _renter_expire_and_catchup(p_org_id uuid, p_renter_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
  v_slot record;
  v_start timestamptz;
  v_end timestamptz;
  v_charged boolean;
  v_allowed boolean;
BEGIN
  v_allowed := _renter_reliability_tick_allowed(p_org_id);

  -- §4.1 p.1 awaiting expired or past start → auto_deleted
  FOR v_slot IN
    SELECT r.*
    FROM rentals r
    WHERE r.organization_id = p_org_id
      AND r.renter_id = p_renter_id
      AND r.channel = 'miniapp'
      AND r.lifecycle = 'awaiting_payment'
  LOOP
    v_start := _renter_slot_ts(p_org_id, v_slot.rental_date, v_slot.time_start);
    IF v_now >= COALESCE(v_slot.hold_expires_at, v_start) OR v_now >= v_start THEN
      PERFORM _renter_mark_terminal(v_slot.id, 'auto_deleted', 'miniapp_auto_deleted', NULL);
      PERFORM _renter_apply_reliability(v_slot.id, 'untimely', v_allowed);
      PERFORM _renter_after_pack_slot_terminal(v_slot.rental_series_id);
    END IF;
  END LOOP;

  -- §4.1 p.2 active ∧ now ≥ time_end → charge prepay then remainder; never auto_deleted
  FOR v_slot IN
    SELECT r.*
    FROM rentals r
    WHERE r.organization_id = p_org_id
      AND r.renter_id = p_renter_id
      AND r.channel = 'miniapp'
      AND r.lifecycle = 'active'
  LOOP
    v_end := _renter_slot_ts(p_org_id, v_slot.rental_date, v_slot.time_end);
    IF v_now < v_end THEN
      CONTINUE;
    END IF;

    v_charged := _renter_charge_prepay(v_slot.id);
    IF NOT v_charged THEN
      UPDATE rentals
      SET
        lifecycle = 'debt',
        debt_amount = GREATEST(debt_amount, fixed_amount),
        updated_at = now()
      WHERE id = v_slot.id;
    ELSE
      PERFORM _renter_charge_remainder(v_slot.id);
    END IF;
    PERFORM _renter_after_pack_slot_terminal(v_slot.rental_series_id);
  END LOOP;

  -- §4.1 p.3 active ∧ time_start ≤ now < time_end → charge or auto_deleted
  FOR v_slot IN
    SELECT r.*
    FROM rentals r
    WHERE r.organization_id = p_org_id
      AND r.renter_id = p_renter_id
      AND r.channel = 'miniapp'
      AND r.lifecycle = 'active'
  LOOP
    v_start := _renter_slot_ts(p_org_id, v_slot.rental_date, v_slot.time_start);
    v_end := _renter_slot_ts(p_org_id, v_slot.rental_date, v_slot.time_end);
    IF v_now < v_start OR v_now >= v_end THEN
      CONTINUE;
    END IF;

    IF NOT _renter_charge_prepay(v_slot.id) THEN
      PERFORM _renter_mark_terminal(v_slot.id, 'auto_deleted', 'miniapp_auto_deleted', NULL);
      PERFORM _renter_apply_reliability(v_slot.id, 'untimely', v_allowed);
      PERFORM _renter_after_pack_slot_terminal(v_slot.rental_series_id);
    END IF;
  END LOOP;

  -- §4.1 p.4 active in T−24 window before start → charge or back to awaiting
  FOR v_slot IN
    SELECT r.*
    FROM rentals r
    WHERE r.organization_id = p_org_id
      AND r.renter_id = p_renter_id
      AND r.channel = 'miniapp'
      AND r.lifecycle = 'active'
  LOOP
    v_start := _renter_slot_ts(p_org_id, v_slot.rental_date, v_slot.time_start);
    IF v_now < v_start - interval '24 hours' OR v_now >= v_start THEN
      CONTINUE;
    END IF;

    IF NOT _renter_charge_prepay(v_slot.id) THEN
      UPDATE rentals
      SET
        lifecycle = 'awaiting_payment',
        hold_expires_at = LEAST(v_now + interval '24 hours', v_start),
        updated_at = now()
      WHERE id = v_slot.id;
    END IF;
  END LOOP;

  -- §4.1 p.5 prepaid_charged ∧ now ≥ time_end → remainder / debt
  FOR v_slot IN
    SELECT r.*
    FROM rentals r
    WHERE r.organization_id = p_org_id
      AND r.renter_id = p_renter_id
      AND r.channel = 'miniapp'
      AND r.lifecycle = 'prepaid_charged'
  LOOP
    v_end := _renter_slot_ts(p_org_id, v_slot.rental_date, v_slot.time_end);
    IF v_now >= v_end THEN
      PERFORM _renter_charge_remainder(v_slot.id);
      PERFORM _renter_after_pack_slot_terminal(v_slot.rental_series_id);
    END IF;
  END LOOP;

  PERFORM _renter_apply_wallet(p_org_id, p_renter_id);
END;
$$;

COMMENT ON FUNCTION _renter_expire_and_catchup(uuid, uuid) IS
  'R1c/R1d: §4.1 catch-up/expiry in one pass. Worker claims renters and calls this. Reliability via apply_reliability stub.';

-- =============================================================================
-- Telegram drain stub (R4 replaces body; must not block expiry)
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_drain_telegram_outbox()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- R1d no-op. R4 replaces this body in-place (same name).
  RETURN;
END;
$$;

COMMENT ON FUNCTION _renter_drain_telegram_outbox() IS
  'R1d stub. R4 drains renter_telegram_outbox here without blocking expiry.';

-- =============================================================================
-- Claim + maintenance tick
-- =============================================================================

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
    SELECT DISTINCT r.organization_id, r.renter_id
    FROM rentals r
    WHERE r.channel = 'miniapp'
      AND (
        (
          r.lifecycle = 'awaiting_payment'
          AND (
            COALESCE(r.hold_expires_at, _renter_slot_ts(r.organization_id, r.rental_date, r.time_start)) <= now()
            OR _renter_slot_ts(r.organization_id, r.rental_date, r.time_start) <= now()
          )
        )
        OR (
          r.lifecycle = 'active'
          AND _renter_slot_ts(r.organization_id, r.rental_date, r.time_start) - interval '24 hours' <= now()
        )
        OR (
          r.lifecycle = 'prepaid_charged'
          AND _renter_slot_ts(r.organization_id, r.rental_date, r.time_end) <= now()
        )
      )
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
  'R1d: FOR UPDATE SKIP LOCKED renters with unfinished Mini App slots. Called from run_renter_booking_maintenance.';

CREATE OR REPLACE FUNCTION run_renter_booking_maintenance(p_batch_size integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row record;
  v_n integer := 0;
  v_extra jsonb;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size < 1 OR p_batch_size > 100 THEN
    RAISE EXCEPTION 'invalid_batch_size';
  END IF;

  FOR v_row IN
    SELECT c.organization_id, c.renter_id
    FROM claim_renter_booking_maintenance(p_batch_size) c
  LOOP
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
    v_n := v_n + 1;
  END LOOP;

  -- Drain after expiry so a slow Bot API cannot skip hold ticks. Body is no-op until R4.
  PERFORM _renter_drain_telegram_outbox();

  RETURN jsonb_build_object('ok', true, 'processed', v_n);
END;
$$;

COMMENT ON FUNCTION run_renter_booking_maintenance(integer) IS
  'R1d worker tick: claim renters, lock, call R1c expire/catch-up/FIFO. Drain Telegram is a no-op until R4.';

REVOKE ALL ON FUNCTION _renter_reliability_tick_allowed(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_drain_telegram_outbox() FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_renter_booking_maintenance(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION run_renter_booking_maintenance(integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION _renter_reliability_tick_allowed(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_drain_telegram_outbox() TO service_role;
GRANT EXECUTE ON FUNCTION claim_renter_booking_maintenance(integer) TO service_role;
GRANT EXECUTE ON FUNCTION run_renter_booking_maintenance(integer) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_expire_and_catchup(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_acquire_miniapp_locks(uuid, uuid, jsonb) TO service_role;

COMMIT;
