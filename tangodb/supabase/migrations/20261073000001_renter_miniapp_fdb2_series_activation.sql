-- FDB2 / 2.9.55: atomic series activation on topup; cancel/expiry for awaiting_payment series.

BEGIN;

-- =============================================================================
-- 1. Atomic activation — all occurrences or none
-- =============================================================================

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

      IF v_now >= v_start - interval '24 hours' THEN
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
  END LOOP;
END;
$$;

COMMENT ON FUNCTION _renter_activate_series_holds(uuid, uuid) IS
  'FDB2: when spendable covers full series prepay, activate all occurrences atomically (no partial dates).';

-- =============================================================================
-- 2. FIFO — series activation before per-slot FIFO
-- =============================================================================

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

    IF v_now >= v_start - interval '24 hours' AND v_now < v_start THEN
      IF _renter_charge_prepay(v_slot.id) THEN
        NULL;
      END IF;
    ELSE
      UPDATE rentals
      SET lifecycle = 'active', updated_at = now()
      WHERE id = v_slot.id
        AND lifecycle = 'awaiting_payment';
      PERFORM _renter_assert_wallet_invariant(p_org_id, p_renter_id);
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION _renter_fifo_activate(uuid, uuid) IS
  'R1c/FDB1/FDB2: series-hold activation then per-slot FIFO for non-pack holds.';

-- =============================================================================
-- 3. Early close — awaiting_payment series can cancel without surcharge
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_early_close_pack(p_series_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_series rental_series%ROWTYPE;
  v_now timestamptz := now();
  v_slot record;
  v_one_time numeric;
  v_penalty numeric;
  v_rate numeric;
  v_minutes integer;
  v_hours numeric;
  v_currency text;
  v_recalc numeric;
  v_already numeric;
  v_delta numeric;
  v_spendable numeric;
  v_take numeric;
  v_has_terminal boolean;
  v_has_future boolean;
BEGIN
  IF p_series_id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_series FROM rental_series WHERE id = p_series_id FOR UPDATE;
  IF NOT FOUND
     OR v_series.channel <> 'miniapp'
     OR v_series.status NOT IN ('active', 'awaiting_payment') THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM rentals r
    WHERE r.rental_series_id = p_series_id
      AND r.channel = 'miniapp'
      AND r.lifecycle IN ('awaiting_payment', 'active', 'prepaid_charged')
      AND _renter_slot_ts(r.organization_id, r.rental_date, r.time_start) > v_now
  ) INTO v_has_future;

  IF v_has_future THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM rentals r
    WHERE r.rental_series_id = p_series_id
      AND r.channel = 'miniapp'
      AND r.lifecycle IN ('cancelled', 'hold_deleted', 'auto_deleted')
  ) INTO v_has_terminal;

  IF NOT v_has_terminal THEN
    PERFORM _renter_try_complete_pack(p_series_id);
    RETURN;
  END IF;

  IF v_series.status = 'awaiting_payment' THEN
    UPDATE rental_series
    SET status = 'cancelled', hold_expires_at = NULL, updated_at = now()
    WHERE id = p_series_id;
    RETURN;
  END IF;

  v_currency := _renter_org_currency(v_series.organization_id);

  FOR v_slot IN
    SELECT r.*
    FROM rentals r
    WHERE r.rental_series_id = p_series_id
      AND r.channel = 'miniapp'
      AND _renter_slot_ts(r.organization_id, r.rental_date, r.time_end) <= v_now
      AND r.lifecycle IN ('settled', 'debt', 'prepaid_charged', 'active')
    ORDER BY r.rental_date, r.time_start
  LOOP
    v_one_time := _renter_hour_rate(
      v_series.organization_id, v_series.location_id, 'one_time', v_slot.rental_date
    );
    v_penalty := _renter_hour_rate(
      v_series.organization_id, v_series.location_id, 'penalty', v_slot.rental_date
    );
    IF EXISTS (
      SELECT 1 FROM renters x
      WHERE x.id = v_series.renter_id AND x.penalty_tariff_applied_at IS NOT NULL
    ) THEN
      v_rate := GREATEST(COALESCE(v_one_time, 0), COALESCE(v_penalty, 0));
    ELSE
      v_rate := COALESCE(v_one_time, 0);
    END IF;

    v_minutes := _hhmm_to_minutes(v_slot.time_end) - _hhmm_to_minutes(v_slot.time_start);
    v_hours := v_minutes::numeric / 60;
    v_recalc := _renter_round_money(v_hours * v_rate, v_currency);
    v_already := COALESCE(v_slot.prepay_amount, 0)
      * CASE WHEN v_slot.prepay_charged_at IS NOT NULL THEN 1 ELSE 0 END
      + COALESCE(v_slot.remainder_amount, 0)
      * CASE WHEN v_slot.remainder_charged_at IS NOT NULL THEN 1 ELSE 0 END;
    v_delta := GREATEST(0, v_recalc - v_already);
    IF v_delta <= 0 THEN
      CONTINUE;
    END IF;

    v_spendable := _renter_wallet_spendable(v_series.organization_id, v_series.renter_id);
    v_take := LEAST(v_spendable, v_delta);

    IF v_take > 0 THEN
      PERFORM _renter_wallet_insert_entry(
        v_series.organization_id,
        v_series.renter_id,
        'surcharge_one_time_recalc',
        v_take,
        v_slot.id,
        'surcharge'
      );
    END IF;

    IF v_delta - v_take > 0 THEN
      UPDATE rentals
      SET
        debt_amount = (v_delta - v_take),
        lifecycle = CASE
          WHEN lifecycle IN ('settled', 'prepaid_charged', 'active') THEN 'debt'
          ELSE lifecycle
        END,
        updated_at = now()
      WHERE id = v_slot.id;
    END IF;
  END LOOP;

  UPDATE rental_series
  SET status = 'cancelled', hold_expires_at = NULL, updated_at = now()
  WHERE id = p_series_id
    AND status IN ('active', 'awaiting_payment');
END;
$$;

COMMENT ON FUNCTION _renter_early_close_pack(uuid) IS
  'R1c/FDB2: early close; awaiting_payment pack with all holds released → cancelled without surcharge.';

-- =============================================================================
-- 4. Cancel eligibility — series on hold is cancellable
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_series_has_cancellable_pack_slots(
  p_series_id uuid,
  p_is_renter boolean
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_series rental_series%ROWTYPE;
  v_now timestamptz := now();
  v_slot record;
  v_start timestamptz;
BEGIN
  IF p_series_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO v_series FROM rental_series WHERE id = p_series_id;
  IF NOT FOUND
     OR v_series.channel IS DISTINCT FROM 'miniapp'
     OR v_series.status NOT IN ('active', 'awaiting_payment') THEN
    RETURN false;
  END IF;

  FOR v_slot IN
    SELECT r.organization_id, r.rental_date, r.time_start, r.lifecycle
    FROM rentals r
    WHERE r.rental_series_id = p_series_id
      AND r.channel = 'miniapp'
      AND r.lifecycle IN ('awaiting_payment', 'active', 'prepaid_charged')
  LOOP
    v_start := _renter_slot_ts(v_slot.organization_id, v_slot.rental_date, v_slot.time_start);
    IF p_is_renter AND v_now >= v_start THEN
      CONTINUE;
    END IF;
    RETURN true;
  END LOOP;

  RETURN false;
END;
$$;

-- =============================================================================
-- 5. renter_cancel_pack — allow awaiting_payment series (batch, one FIFO)
-- =============================================================================

CREATE OR REPLACE FUNCTION renter_cancel_pack(p_series_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_ctx record;
  v_s rental_series%ROWTYPE;
  v_slot record;
  v_now timestamptz := now();
  v_start timestamptz;
  v_extra jsonb := '[]'::jsonb;
  v_reasons jsonb := '[]'::jsonb;
  v_reason text;
BEGIN
  SELECT * INTO v_ctx FROM _renter_actor_ctx();

  SELECT * INTO v_s FROM rental_series WHERE id = p_series_id;
  IF NOT FOUND OR v_s.organization_id IS DISTINCT FROM v_ctx.org_id OR v_s.channel <> 'miniapp' THEN
    PERFORM _renter_raise('renter.forbidden');
  END IF;
  IF v_ctx.is_renter AND v_s.renter_id IS DISTINCT FROM v_ctx.jwt_renter_id THEN
    PERFORM _renter_raise('renter.forbidden');
  END IF;
  IF v_s.status NOT IN ('active', 'awaiting_payment') THEN
    PERFORM _renter_raise('renter.cancel.packNotCancellable');
  END IF;
  IF NOT _renter_series_has_cancellable_pack_slots(p_series_id, v_ctx.is_renter) THEN
    PERFORM _renter_raise('renter.cancel.packNotCancellable');
  END IF;

  FOR v_slot IN
    SELECT r.id, r.location_id, r.rental_date, r.lifecycle
    FROM rentals r
    WHERE r.rental_series_id = p_series_id
      AND r.channel = 'miniapp'
  LOOP
    v_extra := v_extra || jsonb_build_array(
      jsonb_build_object('location_id', v_slot.location_id, 'date', v_slot.rental_date)
    );
  END LOOP;

  PERFORM _renter_acquire_miniapp_locks(v_ctx.org_id, v_s.renter_id, v_extra);

  FOR v_slot IN
    SELECT r.id, r.rental_date, r.time_start, r.lifecycle, r.organization_id
    FROM rentals r
    WHERE r.rental_series_id = p_series_id
      AND r.channel = 'miniapp'
      AND r.lifecycle IN ('awaiting_payment', 'active', 'prepaid_charged')
  LOOP
    v_start := _renter_slot_ts(v_slot.organization_id, v_slot.rental_date, v_slot.time_start);
    IF v_ctx.is_renter AND v_now >= v_start THEN
      CONTINUE;
    END IF;
    IF v_slot.lifecycle = 'awaiting_payment' THEN
      PERFORM _renter_delete_hold_slot(v_slot.id, v_ctx.member_id, true);
      v_reason := 'hold_deleted';
    ELSE
      v_reason := _renter_cancel_one_slot(v_slot.id, v_ctx.is_renter, v_ctx.member_id, true);
    END IF;
    v_reasons := v_reasons || jsonb_build_array(
      jsonb_build_object('rental_id', v_slot.id, 'reason', v_reason)
    );
  END LOOP;

  IF jsonb_array_length(v_reasons) = 0 THEN
    PERFORM _renter_raise('renter.cancel.packNotCancellable');
  END IF;

  PERFORM _renter_apply_wallet(v_ctx.org_id, v_s.renter_id);
  PERFORM _renter_after_pack_slot_terminal(p_series_id);

  RETURN jsonb_build_object(
    'success', true,
    'series_id', p_series_id,
    'cancelled', v_reasons
  );
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

COMMENT ON FUNCTION renter_cancel_pack(uuid) IS
  'FA4/FB4/FDB2: batch cancel pack; awaiting_payment series allowed; one FIFO at end.';

REVOKE ALL ON FUNCTION _renter_activate_series_holds(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION _renter_activate_series_holds(uuid, uuid) TO service_role;

COMMIT;
