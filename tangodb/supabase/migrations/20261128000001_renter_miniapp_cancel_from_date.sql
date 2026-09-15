-- Mini App: occupancy cancel flags; future debt slots cancellable before start;
-- renter_cancel_pack_from_date — partial pack cancel from calendar date (inclusive).

BEGIN;

CREATE OR REPLACE FUNCTION _renter_can_cancel_occurrence_row(
  p_r rentals,
  p_is_renter boolean
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
  v_start timestamptz;
  v_end timestamptz;
BEGIN
  IF p_r.channel IS DISTINCT FROM 'miniapp' THEN
    RETURN false;
  END IF;
  IF p_r.lifecycle NOT IN ('active', 'prepaid_charged', 'debt') THEN
    RETURN false;
  END IF;

  v_start := _renter_slot_ts(p_r.organization_id, p_r.rental_date, p_r.time_start);
  v_end := _renter_slot_ts(p_r.organization_id, p_r.rental_date, p_r.time_end);
  IF v_now >= v_end THEN
    RETURN false;
  END IF;
  IF p_is_renter AND v_now >= v_start THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$$;

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

  v_start := _renter_slot_ts(v_r.organization_id, v_r.rental_date, v_r.time_start);
  v_end := _renter_slot_ts(v_r.organization_id, v_r.rental_date, v_r.time_end);

  IF v_r.lifecycle IN ('settled', 'cancelled', 'auto_deleted', 'hold_deleted') THEN
    PERFORM _renter_raise('renter.booking.notCancellable');
  END IF;
  IF v_r.lifecycle = 'debt' AND v_now >= v_end THEN
    PERFORM _renter_raise('renter.booking.notCancellable');
  END IF;

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
    IF NOT p_defer_wallet THEN
      PERFORM _renter_after_pack_slot_terminal(v_r.rental_series_id);
    END IF;
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
  IF NOT p_defer_wallet THEN
    PERFORM _renter_after_pack_slot_terminal(v_r.rental_series_id);
  END IF;

  IF NOT p_defer_wallet THEN
    PERFORM _renter_apply_wallet(v_r.organization_id, v_r.renter_id);
  END IF;

  IF NOT p_is_renter AND p_member_id IS NOT NULL THEN
    PERFORM _renter_enqueue_staff_cancelled(p_rental_id);
  END IF;

  RETURN v_reason;
END;
$$;

CREATE OR REPLACE FUNCTION renter_get_occupancy(
  p_location_id uuid,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_ctx record;
  v_win record;
  v_from date;
  v_to date;
  v_busy jsonb;
  v_mine jsonb;
BEGIN
  SELECT * INTO v_ctx FROM _renter_require_renter_ctx();
  SELECT * INTO v_win FROM _renter_occupancy_window(v_ctx.org_id);

  IF NOT _renter_location_channel_ok(v_ctx.org_id, p_location_id, v_win.window_start) THEN
    PERFORM _renter_raise('renter.booking.locationUnavailable');
  END IF;

  v_from := COALESCE(p_from, v_win.window_start);
  v_to := COALESCE(p_to, v_win.window_end);
  IF v_from < v_win.window_start THEN
    v_from := v_win.window_start;
  END IF;
  IF v_to > v_win.window_end THEN
    v_to := v_win.window_end;
  END IF;
  IF v_from > v_to THEN
    PERFORM _renter_raise('renter.booking.outsideWindow');
  END IF;

  SELECT COALESCE(jsonb_agg(item ORDER BY d, ts, te), '[]'::jsonb)
  INTO v_busy
  FROM (
    SELECT DISTINCT
      p.date AS d,
      p.time_start AS ts,
      p.time_end AS te,
      jsonb_build_object('date', p.date, 'time_start', p.time_start, 'time_end', p.time_end) AS item
    FROM personal_lessons p
    WHERE p.organization_id = v_ctx.org_id
      AND p.location_id = p_location_id
      AND p.cancelled_at IS NULL
      AND p.date BETWEEN v_from AND v_to
    UNION
    SELECT
      gs::date,
      s.time,
      s.time_end,
      jsonb_build_object('date', gs::date, 'time_start', s.time, 'time_end', s.time_end)
    FROM schedule_slots s
    CROSS JOIN generate_series(v_from, v_to, interval '1 day') gs
    WHERE s.organization_id = v_ctx.org_id
      AND s.location_id = p_location_id
      AND s.day_of_week = EXTRACT(ISODOW FROM gs)::integer
      AND _schedule_slot_active_on_date(s.valid_from, s.valid_to, gs::date)
      AND NOT EXISTS (
        SELECT 1 FROM schedule_occurrence_cancellations soc
        WHERE soc.organization_id = v_ctx.org_id
          AND soc.slot_id = s.id
          AND soc.occurrence_date = gs::date
      )
    UNION
    SELECT
      ces.session_date,
      ces.time_start,
      ces.time_end,
      jsonb_build_object('date', ces.session_date, 'time_start', ces.time_start, 'time_end', ces.time_end)
    FROM calendar_event_sessions ces
    WHERE ces.organization_id = v_ctx.org_id
      AND ces.location_id = p_location_id
      AND ces.session_date BETWEEN v_from AND v_to
    UNION
    SELECT
      r.rental_date,
      r.time_start,
      r.time_end,
      jsonb_build_object('date', r.rental_date, 'time_start', r.time_start, 'time_end', r.time_end)
    FROM rentals r
    WHERE r.organization_id = v_ctx.org_id
      AND r.location_id = p_location_id
      AND r.booking_status = 'confirmed'
      AND r.rental_date BETWEEN v_from AND v_to
  ) z(d, ts, te, item);

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'date', r.rental_date,
      'time_start', r.time_start,
      'time_end', r.time_end,
      'lifecycle', r.lifecycle,
      'rental_series_id', r.rental_series_id,
      'can_delete_hold', _renter_can_delete_hold_row(r, true),
      'can_cancel_occurrence', _renter_can_cancel_occurrence_row(r, true)
    ) ORDER BY r.rental_date, r.time_start
  ), '[]'::jsonb)
  INTO v_mine
  FROM rentals r
  WHERE r.organization_id = v_ctx.org_id
    AND r.renter_id = v_ctx.renter_id
    AND r.location_id = p_location_id
    AND r.channel = 'miniapp'
    AND r.booking_status = 'confirmed'
    AND COALESCE(r.lifecycle, '') NOT IN ('cancelled', 'auto_deleted', 'hold_deleted')
    AND r.rental_date BETWEEN v_from AND v_to;

  RETURN jsonb_build_object(
    'success', true,
    'window', jsonb_build_object('from', v_win.window_start, 'to', v_win.window_end),
    'from', v_from,
    'to', v_to,
    'busy', v_busy,
    'mine', v_mine
  );
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

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
  v_s rental_series%ROWTYPE;
  v_slot record;
  v_now timestamptz := now();
  v_start timestamptz;
  v_extra jsonb := '[]'::jsonb;
  v_reasons jsonb := '[]'::jsonb;
  v_reason text;
BEGIN
  SELECT * INTO v_ctx FROM _renter_actor_ctx();

  IF p_from_date IS NULL THEN
    PERFORM _renter_raise('renter.cancel.packNotCancellable');
  END IF;

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

  FOR v_slot IN
    SELECT r.id, r.location_id, r.rental_date, r.lifecycle
    FROM rentals r
    WHERE r.rental_series_id = p_series_id
      AND r.channel = 'miniapp'
      AND r.rental_date >= p_from_date
  LOOP
    v_extra := v_extra || jsonb_build_array(
      jsonb_build_object('location_id', v_slot.location_id, 'date', v_slot.rental_date)
    );
  END LOOP;

  IF jsonb_array_length(v_extra) = 0 THEN
    PERFORM _renter_raise('renter.cancel.packNotCancellable');
  END IF;

  PERFORM _renter_acquire_miniapp_locks(v_ctx.org_id, v_s.renter_id, v_extra);

  FOR v_slot IN
    SELECT r.id, r.rental_date, r.time_start, r.lifecycle, r.organization_id, r.prepay_charged_at
    FROM rentals r
    WHERE r.rental_series_id = p_series_id
      AND r.channel = 'miniapp'
      AND r.rental_date >= p_from_date
      AND r.lifecycle IN ('awaiting_payment', 'active', 'prepaid_charged', 'debt')
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

COMMENT ON FUNCTION renter_cancel_pack_from_date(uuid, date) IS
  'Renter/staff: cancel or delete holds for pack occurrences on and after from_date (partial pack; incremental early-close).';

REVOKE ALL ON FUNCTION renter_cancel_pack_from_date(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION renter_cancel_pack_from_date(uuid, date) TO authenticated, service_role;

COMMIT;
