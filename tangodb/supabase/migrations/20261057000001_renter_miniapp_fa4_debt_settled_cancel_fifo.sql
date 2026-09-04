-- FA4 / 2.9.38: P1-16 debt→settled on full pay; P1-18 batch cancel/ban without mid-loop FIFO.

BEGIN;

-- =============================================================================
-- 1. Invariant: miniapp lifecycle=debt requires debt_amount > 0
-- =============================================================================

ALTER TABLE rentals
  DROP CONSTRAINT IF EXISTS rentals_miniapp_debt_zero_chk;

ALTER TABLE rentals
  ADD CONSTRAINT rentals_miniapp_debt_zero_chk
    CHECK (
      channel <> 'miniapp'
      OR lifecycle IS DISTINCT FROM 'debt'
      OR debt_amount > 0
    );

-- =============================================================================
-- 2. _renter_debt_settle — full pay → settled (incl. remainder debt)
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_debt_settle(p_org_id uuid, p_renter_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_slot record;
  v_spendable numeric;
  v_amount numeric;
  v_phase text;
  v_ledger_id uuid;
BEGIN
  LOOP
    v_spendable := _renter_wallet_spendable(p_org_id, p_renter_id);
    IF v_spendable <= 0 THEN
      EXIT;
    END IF;

    SELECT r.id, r.debt_amount, r.debt_charge_seq
    INTO v_slot
    FROM rentals r
    WHERE r.organization_id = p_org_id
      AND r.renter_id = p_renter_id
      AND r.channel = 'miniapp'
      AND r.debt_amount > 0
    ORDER BY
      _renter_slot_ts(r.organization_id, r.rental_date, r.time_end),
      r.created_at
    LIMIT 1;

    EXIT WHEN v_slot.id IS NULL;
    EXIT WHEN v_spendable < v_slot.debt_amount;

    v_amount := v_slot.debt_amount;
    v_phase := 'debt_settle:' || COALESCE(v_slot.debt_charge_seq, 1);

    v_ledger_id := _renter_wallet_insert_entry(
      p_org_id,
      p_renter_id,
      'debt_settle',
      v_amount,
      v_slot.id,
      v_phase
    );

    IF v_ledger_id IS NULL THEN
      EXIT;
    END IF;

    UPDATE rentals
    SET
      debt_amount = 0,
      lifecycle = 'settled',
      remainder_charged_at = CASE
        WHEN remainder_charged_at IS NULL AND remainder_amount > 0 THEN now()
        ELSE remainder_charged_at
      END,
      updated_at = now()
    WHERE id = v_slot.id;

    IF FOUND THEN
      PERFORM _renter_enqueue_debt_settled(v_slot.id, v_amount);
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION _renter_debt_settle(uuid, uuid) IS
  'FA4: debt settle clears debt_amount and transitions lifecycle to settled atomically (incl. remainder debt).';

-- =============================================================================
-- 3. Slot cancel helpers — optional deferred wallet (batch cancel/ban)
-- =============================================================================

DROP FUNCTION IF EXISTS _renter_delete_hold_slot(uuid, uuid);

CREATE OR REPLACE FUNCTION _renter_delete_hold_slot(
  p_rental_id uuid,
  p_member_id uuid,
  p_defer_wallet boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_r rentals%ROWTYPE;
BEGIN
  SELECT * INTO v_r FROM rentals WHERE id = p_rental_id FOR UPDATE;
  IF NOT FOUND OR v_r.channel <> 'miniapp' THEN
    PERFORM _renter_raise('renter.booking.notCancellable');
  END IF;

  IF v_r.lifecycle IS DISTINCT FROM 'awaiting_payment' OR v_r.prepay_charged_at IS NOT NULL THEN
    PERFORM _renter_raise('renter.cancel.notHold');
  END IF;

  PERFORM _renter_mark_terminal(v_r.id, 'hold_deleted', 'miniapp_hold_deleted', p_member_id);
  PERFORM _renter_after_pack_slot_terminal(v_r.rental_series_id);

  IF NOT p_defer_wallet THEN
    PERFORM _renter_apply_wallet(v_r.organization_id, v_r.renter_id);
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS _renter_cancel_one_slot(uuid, boolean, uuid);

CREATE OR REPLACE FUNCTION _renter_cancel_one_slot(
  p_rental_id uuid,
  p_is_renter boolean,
  p_member_id uuid,
  p_defer_wallet boolean DEFAULT false
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_r rentals%ROWTYPE;
  v_now timestamptz := now();
  v_start timestamptz;
  v_end timestamptz;
  v_reason text;
BEGIN
  SELECT * INTO v_r FROM rentals WHERE id = p_rental_id FOR UPDATE;
  IF NOT FOUND OR v_r.channel <> 'miniapp' THEN
    PERFORM _renter_raise('renter.booking.notCancellable');
  END IF;

  IF v_r.lifecycle IN ('settled', 'debt', 'cancelled', 'auto_deleted', 'hold_deleted') THEN
    PERFORM _renter_raise('renter.booking.notCancellable');
  END IF;

  v_start := _renter_slot_ts(v_r.organization_id, v_r.rental_date, v_r.time_start);
  v_end := _renter_slot_ts(v_r.organization_id, v_r.rental_date, v_r.time_end);

  IF v_now >= v_end THEN
    PERFORM _renter_raise('renter.booking.notCancellable');
  END IF;

  IF p_is_renter AND v_now >= v_start THEN
    PERFORM _renter_raise('renter.booking.alreadyStarted');
  END IF;

  IF v_r.lifecycle = 'awaiting_payment' AND v_r.prepay_charged_at IS NULL THEN
    IF p_is_renter THEN
      PERFORM _renter_raise('renter.cancel.useDeleteHold');
    END IF;
    PERFORM _renter_mark_terminal(v_r.id, 'hold_deleted', 'miniapp_hold_deleted', p_member_id);
    PERFORM _renter_after_pack_slot_terminal(v_r.rental_series_id);
    IF NOT p_defer_wallet THEN
      PERFORM _renter_apply_wallet(v_r.organization_id, v_r.renter_id);
    END IF;
    RETURN 'hold_deleted';
  END IF;

  IF p_is_renter AND v_r.lifecycle = 'awaiting_payment' THEN
    PERFORM _renter_raise('renter.cancel.useDeleteHold');
  END IF;

  IF v_now < v_start - interval '24 hours' THEN
    PERFORM _renter_refund_prepay(v_r.id);
    v_reason := 'miniapp_cancel_refund';
  ELSE
    IF v_r.prepay_charged_at IS NULL THEN
      IF NOT _renter_charge_prepay(v_r.id) THEN
        v_reason := 'miniapp_cancel';
      ELSE
        v_reason := 'miniapp_cancel_retain';
      END IF;
    ELSE
      v_reason := 'miniapp_cancel_retain';
    END IF;
  END IF;

  PERFORM _renter_mark_terminal(v_r.id, 'cancelled', v_reason, p_member_id);
  PERFORM _renter_after_pack_slot_terminal(v_r.rental_series_id);

  IF NOT p_defer_wallet THEN
    PERFORM _renter_apply_wallet(v_r.organization_id, v_r.renter_id);
  END IF;

  IF NOT p_is_renter AND p_member_id IS NOT NULL THEN
    PERFORM _renter_enqueue_staff_cancelled(p_rental_id);
  END IF;

  RETURN v_reason;
END;
$$;

COMMENT ON FUNCTION _renter_delete_hold_slot(uuid, uuid, boolean) IS
  'R1c/FA4: delete awaiting hold. p_defer_wallet=true skips FIFO until batch end.';
COMMENT ON FUNCTION _renter_cancel_one_slot(uuid, boolean, uuid, boolean) IS
  'R4/FA4: cancel one miniapp slot. p_defer_wallet=true skips FIFO until batch end.';

-- =============================================================================
-- 4. renter_cancel_pack — batch terminal transitions, one FIFO at end
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

-- =============================================================================
-- 5. R5 ban cancel — same batch pattern
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_cancel_future_miniapp_for_ban(p_org_id uuid, p_renter_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_slot record;
  v_now timestamptz := now();
  v_start timestamptz;
  v_series_ids uuid[] := '{}';
BEGIN
  FOR v_slot IN
    SELECT r.*
    FROM rentals r
    WHERE r.organization_id = p_org_id
      AND r.renter_id = p_renter_id
      AND r.channel = 'miniapp'
      AND r.lifecycle IN ('awaiting_payment', 'active', 'prepaid_charged')
    ORDER BY r.rental_date, r.time_start, r.created_at
  LOOP
    v_start := _renter_slot_ts(p_org_id, v_slot.rental_date, v_slot.time_start);
    IF v_start <= v_now THEN
      CONTINUE;
    END IF;

    IF v_slot.lifecycle = 'awaiting_payment' AND v_slot.prepay_charged_at IS NULL THEN
      PERFORM _renter_delete_hold_slot(v_slot.id, NULL, true);
    ELSE
      PERFORM _renter_cancel_one_slot(v_slot.id, false, NULL, true);
    END IF;

    IF v_slot.rental_series_id IS NOT NULL THEN
      v_series_ids := array_append(v_series_ids, v_slot.rental_series_id);
    END IF;
  END LOOP;

  PERFORM _renter_apply_wallet(p_org_id, p_renter_id);

  IF v_series_ids <> '{}' THEN
    PERFORM _renter_after_pack_slot_terminal(sid)
    FROM (SELECT DISTINCT unnest(v_series_ids) AS sid) s;
  END IF;
END;
$$;

COMMENT ON FUNCTION _renter_cancel_future_miniapp_for_ban(uuid, uuid) IS
  'R5/FA4: cancel future miniapp slots for ban; one FIFO after batch terminal transitions.';

REVOKE ALL ON FUNCTION _renter_delete_hold_slot(uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_cancel_one_slot(uuid, boolean, uuid, boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION _renter_delete_hold_slot(uuid, uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_cancel_one_slot(uuid, boolean, uuid, boolean) TO service_role;

COMMIT;
