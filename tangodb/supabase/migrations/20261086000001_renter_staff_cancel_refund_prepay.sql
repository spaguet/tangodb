-- Staff CRM cancel of Mini App bookings must return held/charged prepay to wallet.

BEGIN;

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

  IF NOT p_is_renter THEN
    PERFORM _renter_refund_prepay(v_r.id);
    v_reason := 'miniapp_staff_cancel_refund';
  ELSIF v_now < v_start - interval '24 hours' THEN
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
    SELECT r.id, r.rental_date, r.time_start, r.lifecycle, r.organization_id, r.prepay_charged_at
    FROM rentals r
    WHERE r.rental_series_id = p_series_id
      AND r.channel = 'miniapp'
      AND r.lifecycle IN ('awaiting_payment', 'active', 'prepaid_charged')
  LOOP
    v_start := _renter_slot_ts(v_slot.organization_id, v_slot.rental_date, v_slot.time_start);
    IF v_ctx.is_renter AND v_now >= v_start THEN
      CONTINUE;
    END IF;
    IF v_slot.lifecycle = 'awaiting_payment' AND v_slot.prepay_charged_at IS NULL THEN
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

COMMENT ON FUNCTION _renter_cancel_one_slot(uuid, boolean, uuid, boolean) IS
  'R4/FA4/860: cancel one miniapp slot. Staff always refunds charged prepay; renter keeps T−24 rules.';

COMMENT ON FUNCTION renter_cancel_pack(uuid) IS
  'FA4/FDB2/860: batch cancel pack; charged awaiting slots use cancel_one_slot (refund).';

COMMIT;
