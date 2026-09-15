-- Pack cancel / hold delete: include staff-assigned lifecycle=debt slots (CRM recurring).

BEGIN;

CREATE OR REPLACE FUNCTION _renter_can_delete_hold_row(
  p_r rentals,
  p_is_renter boolean
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start timestamptz;
BEGIN
  IF p_r.channel IS DISTINCT FROM 'miniapp' THEN
    RETURN false;
  END IF;
  IF p_r.lifecycle = 'awaiting_payment' AND p_r.prepay_charged_at IS NULL THEN
    RETURN true;
  END IF;
  IF p_r.lifecycle = 'debt'
     AND p_r.prepay_charged_at IS NULL
     AND p_r.created_by IS NOT NULL THEN
    v_start := _renter_slot_ts(p_r.organization_id, p_r.rental_date, p_r.time_start);
    RETURN now() < v_start;
  END IF;
  IF p_is_renter THEN
    RETURN false;
  END IF;
  RETURN false;
END;
$$;

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
  v_slot record;
BEGIN
  IF p_series_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO v_series FROM rental_series WHERE id = p_series_id;
  IF NOT FOUND OR v_series.channel IS DISTINCT FROM 'miniapp' OR v_series.status IS DISTINCT FROM 'active' THEN
    RETURN false;
  END IF;

  FOR v_slot IN
    SELECT r.*
    FROM rentals r
    WHERE r.rental_series_id = p_series_id
      AND r.channel = 'miniapp'
      AND r.lifecycle IN ('awaiting_payment', 'active', 'prepaid_charged', 'debt')
  LOOP
    IF _renter_can_cancel_occurrence_row(v_slot, p_is_renter)
       OR _renter_can_delete_hold_row(v_slot, p_is_renter) THEN
      RETURN true;
    END IF;
  END LOOP;

  RETURN false;
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
  v_r rentals%ROWTYPE;
  v_now timestamptz := now();
  v_start timestamptz;
  v_extra jsonb := '[]'::jsonb;
  v_reasons jsonb := '[]'::jsonb;
  v_reason text;
  v_review jsonb;
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
    SELECT r.id, r.rental_date, r.time_start, r.lifecycle, r.organization_id, r.prepay_charged_at, r.created_by
    FROM rentals r
    WHERE r.rental_series_id = p_series_id
      AND r.channel = 'miniapp'
      AND r.lifecycle IN ('awaiting_payment', 'active', 'prepaid_charged', 'debt')
  LOOP
    SELECT * INTO v_r FROM rentals WHERE id = v_slot.id;

    v_start := _renter_slot_ts(v_slot.organization_id, v_slot.rental_date, v_slot.time_start);
    IF v_ctx.is_renter AND v_now >= v_start THEN
      CONTINUE;
    END IF;

    IF _renter_can_delete_hold_row(v_r, v_ctx.is_renter) THEN
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
  PERFORM _renter_after_pack_slot_terminal(p_series_id, 'bulk_pack');

  SELECT jsonb_build_object(
    'id', r.id,
    'status', r.status,
    'suggested_amount', r.suggested_amount,
    'currency', r.currency,
    'used_week_count', r.used_week_count
  )
  INTO v_review
  FROM rental_series_surcharge_reviews r
  WHERE r.rental_series_id = p_series_id;

  RETURN jsonb_build_object(
    'success', true,
    'series_id', p_series_id,
    'cancelled', v_reasons,
    'surcharge_review', v_review
  );
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
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
  v_r rentals%ROWTYPE;
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
      AND r.lifecycle IN ('awaiting_payment', 'active', 'prepaid_charged', 'debt')
    ORDER BY r.rental_date, r.time_start, r.created_at
  LOOP
    v_start := _renter_slot_ts(p_org_id, v_slot.rental_date, v_slot.time_start);
    IF v_start <= v_now THEN
      CONTINUE;
    END IF;

    v_r := v_slot;

    IF _renter_can_delete_hold_row(v_r, false) THEN
      PERFORM _renter_delete_hold_slot(v_slot.id, NULL);
    ELSE
      PERFORM _renter_cancel_one_slot(v_slot.id, false, NULL);
    END IF;

    IF v_slot.rental_series_id IS NOT NULL THEN
      v_series_ids := array_append(v_series_ids, v_slot.rental_series_id);
    END IF;
  END LOOP;

  IF v_series_ids <> '{}' THEN
    PERFORM _renter_after_pack_slot_terminal(sid, 'ban')
    FROM (SELECT DISTINCT unnest(v_series_ids) AS sid) s;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
