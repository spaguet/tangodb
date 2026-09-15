-- Pack cancel from date: authorize via renter-owned rentals (not rental_series row).

BEGIN;

CREATE OR REPLACE FUNCTION renter_cancel_pack_from_date(
  p_series_id uuid,
  p_from_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_ctx record;
  v_slot record;
  v_now timestamptz := now();
  v_start timestamptz;
  v_extra jsonb := '[]'::jsonb;
  v_reasons jsonb := '[]'::jsonb;
  v_reason text;
BEGIN
  SELECT * INTO v_ctx FROM _renter_require_renter_ctx();

  IF p_series_id IS NULL OR p_from_date IS NULL THEN
    PERFORM _renter_raise('renter.cancel.packNotCancellable');
  END IF;

  FOR v_slot IN
    SELECT r.id, r.location_id, r.rental_date, r.lifecycle
    FROM rentals r
    WHERE r.rental_series_id = p_series_id
      AND r.organization_id = v_ctx.org_id
      AND r.renter_id = v_ctx.renter_id
      AND r.channel = 'miniapp'
      AND r.rental_date >= p_from_date
      AND COALESCE(r.lifecycle, '') NOT IN ('cancelled', 'auto_deleted', 'hold_deleted')
  LOOP
    v_extra := v_extra || jsonb_build_array(
      jsonb_build_object('location_id', v_slot.location_id, 'date', v_slot.rental_date)
    );
  END LOOP;

  IF jsonb_array_length(v_extra) = 0 THEN
    PERFORM _renter_raise('renter.cancel.packNotCancellable');
  END IF;

  PERFORM _renter_acquire_miniapp_locks(v_ctx.org_id, v_ctx.renter_id, v_extra);

  FOR v_slot IN
    SELECT r.id, r.rental_date, r.time_start, r.lifecycle, r.organization_id, r.prepay_charged_at
    FROM rentals r
    WHERE r.rental_series_id = p_series_id
      AND r.organization_id = v_ctx.org_id
      AND r.renter_id = v_ctx.renter_id
      AND r.channel = 'miniapp'
      AND r.rental_date >= p_from_date
      AND r.lifecycle IN ('awaiting_payment', 'active', 'prepaid_charged', 'debt')
      AND COALESCE(r.lifecycle, '') NOT IN ('cancelled', 'auto_deleted', 'hold_deleted')
  LOOP
    v_start := _renter_slot_ts(v_slot.organization_id, v_slot.rental_date, v_slot.time_start);
    IF v_now >= v_start THEN
      CONTINUE;
    END IF;
    IF v_slot.lifecycle = 'awaiting_payment' AND v_slot.prepay_charged_at IS NULL THEN
      PERFORM _renter_delete_hold_slot(v_slot.id, NULL, true);
      v_reason := 'hold_deleted';
    ELSE
      v_reason := _renter_cancel_one_slot(v_slot.id, true, NULL, true);
    END IF;
    v_reasons := v_reasons || jsonb_build_array(
      jsonb_build_object('rental_id', v_slot.id, 'reason', v_reason)
    );
  END LOOP;

  IF jsonb_array_length(v_reasons) = 0 THEN
    PERFORM _renter_raise('renter.cancel.packNotCancellable');
  END IF;

  PERFORM _renter_apply_wallet(v_ctx.org_id, v_ctx.renter_id);
  PERFORM _renter_after_pack_slot_terminal(p_series_id, 'incremental');

  RETURN jsonb_build_object(
    'success', true,
    'series_id', p_series_id,
    'from_date', p_from_date,
    'cancelled', v_reasons
  );
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
