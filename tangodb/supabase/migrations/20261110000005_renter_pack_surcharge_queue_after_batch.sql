-- Pack surcharge review: queue after batch cancel even if per-slot incremental
-- close already marked the series cancelled. Restrict queue to first pack week.

BEGIN;

CREATE OR REPLACE FUNCTION _renter_pack_used_outside_first_week(p_series_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM rentals r
    JOIN rental_series rs ON rs.id = r.rental_series_id
    WHERE r.rental_series_id = p_series_id
      AND r.channel = 'miniapp'
      AND _renter_slot_ts(r.organization_id, r.rental_date, r.time_end) <= now()
      AND r.lifecycle IN ('settled', 'debt', 'prepaid_charged', 'active')
      AND ((r.rental_date - rs.valid_from) / 7) > 0
  );
$$;

CREATE OR REPLACE FUNCTION _renter_maybe_queue_pack_surcharge_review(
  p_series_id uuid,
  p_cancel_mode text DEFAULT 'incremental'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_series rental_series%ROWTYPE;
  v_used_weeks integer;
  v_preview jsonb;
  v_total numeric;
  v_currency text;
BEGIN
  IF p_series_id IS NULL OR p_cancel_mode NOT IN ('bulk_pack', 'ban') THEN
    RETURN;
  END IF;

  SELECT * INTO v_series FROM rental_series WHERE id = p_series_id;
  IF NOT FOUND OR v_series.channel <> 'miniapp' THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM rental_series_surcharge_reviews r
    WHERE r.rental_series_id = p_series_id
  ) THEN
    RETURN;
  END IF;

  v_used_weeks := _renter_pack_used_week_count(p_series_id);
  -- Exactly the first calendar week of the pack (valid_from .. +6 days), not a later isolated week.
  IF v_used_weeks <> 1 OR _renter_pack_used_outside_first_week(p_series_id) THEN
    RETURN;
  END IF;

  v_preview := _renter_compute_pack_surcharge(p_series_id);
  v_total := COALESCE((v_preview ->> 'total')::numeric, 0);
  v_currency := COALESCE(v_preview ->> 'currency', _renter_org_currency(v_series.organization_id));

  IF v_total <= 0 THEN
    RETURN;
  END IF;

  INSERT INTO rental_series_surcharge_reviews (
    organization_id,
    rental_series_id,
    renter_id,
    status,
    suggested_amount,
    currency,
    cancel_mode,
    used_week_count,
    reason_code
  )
  VALUES (
    v_series.organization_id,
    p_series_id,
    v_series.renter_id,
    'pending',
    v_total,
    v_currency,
    p_cancel_mode,
    v_used_weeks,
    'week1_only_bulk_cancel'
  );
END;
$$;

CREATE OR REPLACE FUNCTION _renter_early_close_pack(
  p_series_id uuid,
  p_cancel_mode text DEFAULT 'incremental'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_series rental_series%ROWTYPE;
  v_now timestamptz := now();
  v_has_future boolean;
  v_has_terminal boolean;
BEGIN
  IF p_series_id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_series FROM rental_series WHERE id = p_series_id FOR UPDATE;
  IF NOT FOUND OR v_series.channel <> 'miniapp' THEN
    RETURN;
  END IF;

  -- Per-slot cancel closes the series as incremental before renter_cancel_pack / ban
  -- can pass bulk_pack|ban. Still allow those modes to enqueue review.
  IF v_series.status = 'cancelled' THEN
    PERFORM _renter_maybe_queue_pack_surcharge_review(p_series_id, p_cancel_mode);
    RETURN;
  END IF;

  IF v_series.status NOT IN ('active', 'awaiting_payment') THEN
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

  PERFORM _renter_maybe_queue_pack_surcharge_review(p_series_id, p_cancel_mode);

  UPDATE rental_series
  SET status = 'cancelled', hold_expires_at = NULL, updated_at = now()
  WHERE id = p_series_id
    AND status IN ('active', 'awaiting_payment');
END;
$$;

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
  IF NOT p_defer_wallet THEN
    PERFORM _renter_after_pack_slot_terminal(v_r.rental_series_id);
  END IF;

  IF NOT p_defer_wallet THEN
    PERFORM _renter_apply_wallet(v_r.organization_id, v_r.renter_id);
  END IF;
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
    PERFORM _renter_after_pack_slot_terminal(sid, 'ban')
    FROM (SELECT DISTINCT unnest(v_series_ids) AS sid) s;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION _renter_pack_used_outside_first_week(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION _renter_pack_used_outside_first_week(uuid) TO service_role;

COMMENT ON FUNCTION _renter_early_close_pack(uuid, text) IS
  'Pack early close; bulk/ban may enqueue staff review even if series already cancelled by per-slot close.';

COMMENT ON FUNCTION _renter_maybe_queue_pack_surcharge_review(uuid, text) IS
  'Queue staff review only for bulk/ban close with used time in the first pack week.';

COMMIT;
