-- Staff CRM bookings (created_by = member) keep a 50% wallet reserve until
-- the slot starts. T−24 prepaid_charge is only for renter self-service holds.
-- Charging one of two staff slots early earmarked its remainder and showed
-- spendable as one prepay too low (500k wallet, 2×250k → 125k leftover).

BEGIN;

CREATE OR REPLACE FUNCTION _renter_activate_series_holds(p_org_id uuid, p_renter_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_series record;
  v_slot record;
  v_now timestamptz := now();
  v_start timestamptz;
  v_total_prepay numeric;
  v_available numeric;
  v_remaining integer;
  v_activated boolean := false;
BEGIN
  FOR v_series IN
    SELECT rs.*
    FROM rental_series rs
    WHERE rs.organization_id = p_org_id
      AND rs.renter_id = p_renter_id
      AND rs.channel = 'miniapp'
      AND rs.status = 'awaiting_payment'
      AND rs.hold_expires_at IS NOT NULL
      AND v_now < rs.hold_expires_at
    ORDER BY rs.hold_expires_at, rs.created_at
    FOR UPDATE
  LOOP
    v_activated := false;

    SELECT COALESCE(sum(r.prepay_amount), 0)
    INTO v_total_prepay
    FROM rentals r
    WHERE r.rental_series_id = v_series.id
      AND r.channel = 'miniapp'
      AND r.lifecycle = 'awaiting_payment';

    IF v_total_prepay <= 0 THEN
      CONTINUE;
    END IF;

    v_available := _renter_wallet_available(p_org_id, p_renter_id);
    IF v_available < v_total_prepay THEN
      CONTINUE;
    END IF;

    PERFORM 1
    FROM rentals r
    WHERE r.rental_series_id = v_series.id
      AND r.channel = 'miniapp'
      AND r.lifecycle = 'awaiting_payment'
    FOR UPDATE;

    FOR v_slot IN
      SELECT r.*
      FROM rentals r
      WHERE r.rental_series_id = v_series.id
        AND r.channel = 'miniapp'
        AND r.lifecycle = 'awaiting_payment'
      ORDER BY r.rental_date, r.time_start, r.created_at
    LOOP
      v_start := _renter_slot_ts(p_org_id, v_slot.rental_date, v_slot.time_start);

      IF v_now >= v_start THEN
        RAISE EXCEPTION 'renter.series.activationPastStart';
      END IF;

      IF v_slot.created_by IS NULL AND v_now >= v_start - interval '24 hours' THEN
        IF NOT _renter_charge_prepay(v_slot.id) THEN
          RAISE EXCEPTION 'renter.series.activationChargeFailed';
        END IF;
      ELSE
        UPDATE rentals
        SET
          lifecycle = 'active',
          hold_expires_at = NULL,
          updated_at = now()
        WHERE id = v_slot.id
          AND lifecycle = 'awaiting_payment';
      END IF;
    END LOOP;

    SELECT count(*)
    INTO v_remaining
    FROM rentals r
    WHERE r.rental_series_id = v_series.id
      AND r.channel = 'miniapp'
      AND r.lifecycle = 'awaiting_payment';

    IF v_remaining > 0 THEN
      RAISE EXCEPTION 'renter.series.partialActivationForbidden';
    END IF;

    UPDATE rental_series
    SET
      status = 'active',
      hold_expires_at = NULL,
      updated_at = now()
    WHERE id = v_series.id;

    v_activated := true;

    IF v_activated THEN
      PERFORM _renter_maybe_enqueue_series_activated(v_series.id);
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION _renter_fifo_activate(p_org_id uuid, p_renter_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_slot record;
  v_now timestamptz := now();
  v_start timestamptz;
  v_available numeric;
  v_changed boolean;
BEGIN
  PERFORM _renter_activate_series_holds(p_org_id, p_renter_id);

  FOR v_slot IN
    SELECT r.*
    FROM rentals r
    WHERE r.organization_id = p_org_id
      AND r.renter_id = p_renter_id
      AND r.channel = 'miniapp'
      AND r.lifecycle = 'awaiting_payment'
      AND NOT EXISTS (
        SELECT 1
        FROM rental_series rs
        WHERE rs.id = r.rental_series_id
          AND rs.status = 'awaiting_payment'
      )
    ORDER BY r.rental_date, r.time_start, r.created_at
  LOOP
    v_start := _renter_slot_ts(p_org_id, v_slot.rental_date, v_slot.time_start);

    IF v_now >= v_start OR (v_slot.hold_expires_at IS NOT NULL AND v_now >= v_slot.hold_expires_at) THEN
      CONTINUE;
    END IF;

    v_available := _renter_wallet_available(p_org_id, p_renter_id);
    IF v_available < v_slot.prepay_amount THEN
      CONTINUE;
    END IF;

    v_changed := false;

    IF v_slot.created_by IS NULL
       AND v_now >= v_start - interval '24 hours'
       AND v_now < v_start THEN
      IF _renter_charge_prepay(v_slot.id) THEN
        v_changed := true;
      END IF;
    ELSE
      UPDATE rentals
      SET lifecycle = 'active', updated_at = now()
      WHERE id = v_slot.id
        AND lifecycle = 'awaiting_payment';
      IF FOUND THEN
        v_changed := true;
      END IF;
      PERFORM _renter_assert_wallet_invariant(p_org_id, p_renter_id);
    END IF;

    IF v_changed AND v_slot.rental_series_id IS NOT NULL THEN
      PERFORM _renter_maybe_enqueue_series_activated(v_slot.rental_series_id);
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION _renter_expire_and_catchup(p_org_id uuid, p_renter_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
  v_series record;
  v_slot record;
  v_start timestamptz;
  v_end timestamptz;
  v_charged boolean;
  v_allowed boolean;
  v_was_debt boolean;
BEGIN
  v_allowed := _renter_reliability_tick_allowed(p_org_id);

  FOR v_series IN
    SELECT rs.*
    FROM rental_series rs
    WHERE rs.organization_id = p_org_id
      AND rs.renter_id = p_renter_id
      AND rs.channel = 'miniapp'
      AND rs.status = 'awaiting_payment'
      AND rs.hold_expires_at IS NOT NULL
      AND v_now >= rs.hold_expires_at
  LOOP
    FOR v_slot IN
      SELECT r.*
      FROM rentals r
      WHERE r.rental_series_id = v_series.id
        AND r.lifecycle = 'awaiting_payment'
    LOOP
      PERFORM _renter_mark_terminal(v_slot.id, 'auto_deleted', 'miniapp_auto_deleted', NULL, true);
    END LOOP;

    PERFORM _renter_apply_series_reliability(v_series.id, 'untimely', v_allowed);
    PERFORM _renter_enqueue_series_auto_deleted(v_series.id);

    UPDATE rental_series
    SET status = 'cancelled', hold_expires_at = NULL, updated_at = now()
    WHERE id = v_series.id;

    PERFORM _renter_after_pack_slot_terminal(v_series.id);
  END LOOP;

  FOR v_slot IN
    SELECT r.*
    FROM rentals r
    WHERE r.organization_id = p_org_id
      AND r.renter_id = p_renter_id
      AND r.channel = 'miniapp'
      AND r.lifecycle = 'awaiting_payment'
      AND NOT EXISTS (
        SELECT 1
        FROM rental_series rs
        WHERE rs.id = r.rental_series_id
          AND rs.status = 'awaiting_payment'
      )
  LOOP
    v_start := _renter_slot_ts(p_org_id, v_slot.rental_date, v_slot.time_start);
    IF v_now >= COALESCE(v_slot.hold_expires_at, v_start) OR v_now >= v_start THEN
      PERFORM _renter_mark_terminal(v_slot.id, 'auto_deleted', 'miniapp_auto_deleted', NULL);
      PERFORM _renter_apply_reliability(v_slot.id, 'untimely', v_allowed);
      PERFORM _renter_after_pack_slot_terminal(v_slot.rental_series_id);
    END IF;
  END LOOP;

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
      v_was_debt := v_slot.lifecycle = 'debt';
      UPDATE rentals
      SET
        lifecycle = 'debt',
        debt_amount = GREATEST(debt_amount, fixed_amount),
        updated_at = now()
      WHERE id = v_slot.id
        AND lifecycle IS DISTINCT FROM 'debt';
      IF FOUND AND NOT v_was_debt THEN
        PERFORM _renter_enqueue_debt_accrued(v_slot.id, GREATEST(v_slot.debt_amount, v_slot.fixed_amount));
      END IF;
    ELSE
      PERFORM _renter_charge_remainder(v_slot.id);
    END IF;
    PERFORM _renter_after_pack_slot_terminal(v_slot.rental_series_id);
  END LOOP;

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

  FOR v_slot IN
    SELECT r.*
    FROM rentals r
    WHERE r.organization_id = p_org_id
      AND r.renter_id = p_renter_id
      AND r.channel = 'miniapp'
      AND r.lifecycle = 'active'
      AND r.created_by IS NULL
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
      WHERE id = v_slot.id
        AND lifecycle = 'active';
      IF FOUND THEN
        PERFORM _renter_enqueue_prepay_failed_t24(v_slot.id);
      END IF;
    END IF;
  END LOOP;

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

REVOKE ALL ON FUNCTION _renter_activate_series_holds(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_fifo_activate(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_expire_and_catchup(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION _renter_activate_series_holds(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_fifo_activate(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_expire_and_catchup(uuid, uuid) TO service_role;

COMMENT ON FUNCTION _renter_fifo_activate(uuid, uuid) IS
  'FIFO: renter self-holds charge at T−24; staff CRM slots stay active 50% reserve until start.';

-- Restore staff slots that were prepaid_charged only because of T−24 on CRM create.
DO $$
DECLARE
  v_r rentals%ROWTYPE;
BEGIN
  FOR v_r IN
    SELECT r.*
    FROM rentals r
    WHERE r.channel = 'miniapp'
      AND r.created_by IS NOT NULL
      AND r.lifecycle = 'prepaid_charged'
      AND r.booking_status = 'confirmed'
      AND r.prepay_charged_at IS NOT NULL
      AND r.remainder_charged_at IS NULL
      AND _renter_slot_ts(r.organization_id, r.rental_date, r.time_start) > now()
    ORDER BY r.organization_id, r.renter_id, r.rental_date, r.time_start
    FOR UPDATE
  LOOP
    PERFORM pg_advisory_xact_lock(_renter_wallet_lock_key(v_r.organization_id, v_r.renter_id));
    PERFORM _renter_refund_prepay(v_r.id);
    UPDATE rentals
    SET
      lifecycle = 'active',
      prepay_charged_at = NULL,
      updated_at = now()
    WHERE id = v_r.id
      AND lifecycle = 'prepaid_charged'
      AND remainder_charged_at IS NULL;
    PERFORM _renter_assert_wallet_invariant(v_r.organization_id, v_r.renter_id);
  END LOOP;
END;
$$;

COMMIT;
