-- CRM: cancel all Mini App rentals for a renter on and after a calendar date (all packs / one-offs).

BEGIN;

CREATE OR REPLACE FUNCTION _renter_slot_is_staff_cancellable(
  p_r rentals,
  p_is_renter boolean
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT _renter_can_delete_hold_row(p_r, p_is_renter)
      OR _renter_can_cancel_occurrence_row(p_r, p_is_renter);
$$;

CREATE OR REPLACE FUNCTION _renter_can_cancel_renter_from_date_row(
  p_r rentals,
  p_is_renter boolean
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_slot rentals%ROWTYPE;
  v_count int := 0;
BEGIN
  IF p_r.channel IS DISTINCT FROM 'miniapp' THEN
    RETURN false;
  END IF;

  IF NOT _renter_slot_is_staff_cancellable(p_r, p_is_renter) THEN
    RETURN false;
  END IF;

  FOR v_slot IN
    SELECT r.*
    FROM rentals r
    WHERE r.organization_id = p_r.organization_id
      AND r.renter_id = p_r.renter_id
      AND r.channel = 'miniapp'
      AND r.rental_date >= p_r.rental_date
      AND COALESCE(r.lifecycle, '') NOT IN ('cancelled', 'auto_deleted', 'hold_deleted')
  LOOP
    IF _renter_slot_is_staff_cancellable(v_slot, p_is_renter) THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count >= 2;
END;
$$;

CREATE OR REPLACE FUNCTION renter_cancel_bookings_from_date(
  p_renter_id uuid,
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
  v_r rentals%ROWTYPE;
  v_now timestamptz := now();
  v_start timestamptz;
  v_extra jsonb := '[]'::jsonb;
  v_reasons jsonb := '[]'::jsonb;
  v_reason text;
  v_series_ids uuid[] := '{}';
BEGIN
  SELECT * INTO v_ctx FROM _renter_actor_ctx();

  IF p_renter_id IS NULL OR p_from_date IS NULL THEN
    PERFORM _renter_raise('renter.cancel.renterFromDateNotCancellable');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM renters ren
    WHERE ren.id = p_renter_id AND ren.organization_id = v_ctx.org_id
  ) THEN
    PERFORM _renter_raise('renter.forbidden');
  END IF;

  IF v_ctx.is_renter AND p_renter_id IS DISTINCT FROM v_ctx.jwt_renter_id THEN
    PERFORM _renter_raise('renter.forbidden');
  END IF;

  FOR v_slot IN
    SELECT r.id, r.location_id, r.rental_date
    FROM rentals r
    WHERE r.organization_id = v_ctx.org_id
      AND r.renter_id = p_renter_id
      AND r.channel = 'miniapp'
      AND r.rental_date >= p_from_date
      AND COALESCE(r.lifecycle, '') NOT IN ('cancelled', 'auto_deleted', 'hold_deleted')
  LOOP
    v_extra := v_extra || jsonb_build_array(
      jsonb_build_object('location_id', v_slot.location_id, 'date', v_slot.rental_date)
    );
  END LOOP;

  IF jsonb_array_length(v_extra) = 0 THEN
    PERFORM _renter_raise('renter.cancel.renterFromDateNotCancellable');
  END IF;

  PERFORM _renter_acquire_miniapp_locks(v_ctx.org_id, p_renter_id, v_extra);

  FOR v_slot IN
    SELECT r.id, r.rental_date, r.time_start, r.lifecycle, r.organization_id, r.rental_series_id
    FROM rentals r
    WHERE r.organization_id = v_ctx.org_id
      AND r.renter_id = p_renter_id
      AND r.channel = 'miniapp'
      AND r.rental_date >= p_from_date
      AND r.lifecycle IN ('awaiting_payment', 'active', 'prepaid_charged', 'debt')
    ORDER BY r.rental_date, r.time_start, r.created_at
  LOOP
    v_start := _renter_slot_ts(v_slot.organization_id, v_slot.rental_date, v_slot.time_start);
    IF v_ctx.is_renter AND v_now >= v_start THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_r FROM rentals WHERE id = v_slot.id FOR UPDATE;

    IF NOT _renter_slot_is_staff_cancellable(v_r, v_ctx.is_renter) THEN
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

    IF v_slot.rental_series_id IS NOT NULL THEN
      v_series_ids := array_append(v_series_ids, v_slot.rental_series_id);
    END IF;
  END LOOP;

  IF jsonb_array_length(v_reasons) = 0 THEN
    PERFORM _renter_raise('renter.cancel.renterFromDateNotCancellable');
  END IF;

  PERFORM _renter_apply_wallet(v_ctx.org_id, p_renter_id);

  IF v_series_ids <> '{}' THEN
    PERFORM _renter_after_pack_slot_terminal(sid, 'incremental')
    FROM (SELECT DISTINCT unnest(v_series_ids) AS sid) s;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'renter_id', p_renter_id,
    'from_date', p_from_date,
    'cancelled', v_reasons
  );
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION get_rentals_for_schedule_week(
  p_week_start date,
  p_week_end date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_sensitive boolean;
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  IF NOT can_read_operational() AND current_member_role() <> 'teacher' THEN
    RETURN '[]'::jsonb;
  END IF;

  v_sensitive := member_can_see_rental_sensitive();

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.rental_date, x.time_start), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      r.id AS rental_id,
      r.rental_date,
      r.time_start,
      r.time_end,
      r.location_id,
      r.rental_series_id,
      r.booking_status,
      r.channel,
      r.lifecycle,
      CASE WHEN v_sensitive THEN r.renter_id ELSE NULL END AS renter_id,
      CASE WHEN v_sensitive THEN r.purpose ELSE NULL END AS purpose,
      CASE WHEN v_sensitive THEN ren.display_name ELSE NULL END AS renter_name,
      CASE WHEN v_sensitive THEN _rental_effective_amount(r.fixed_amount, r.final_amount) ELSE NULL END AS fixed_amount,
      CASE WHEN v_sensitive THEN r.currency ELSE NULL END AS currency,
      CASE
        WHEN NOT v_sensitive THEN NULL
        WHEN r.channel = 'miniapp' THEN NULL
        ELSE _rental_paid_total(r.id, r.organization_id)
      END AS paid_amount,
      CASE
        WHEN NOT v_sensitive THEN NULL
        WHEN r.channel = 'miniapp' THEN NULL
        ELSE _rental_payment_status(
          _rental_effective_amount(r.fixed_amount, r.final_amount),
          _rental_paid_total(r.id, r.organization_id)
        )
      END AS payment_status,
      CASE
        WHEN r.channel = 'miniapp' THEN _renter_can_delete_hold_row(r, false)
        ELSE false
      END AS can_delete_hold,
      CASE
        WHEN r.channel = 'miniapp' THEN _renter_can_cancel_occurrence_row(r, false)
        ELSE false
      END AS can_cancel_occurrence,
      CASE
        WHEN r.channel = 'miniapp' THEN _renter_can_cancel_pack_row(r, false)
        ELSE false
      END AS can_cancel_pack,
      CASE
        WHEN r.channel = 'miniapp' THEN _renter_can_cancel_pack_from_date_row(r, false)
        ELSE false
      END AS can_cancel_pack_from_date,
      CASE
        WHEN r.channel = 'miniapp' THEN _renter_can_cancel_renter_from_date_row(r, false)
        ELSE false
      END AS can_cancel_renter_from_date
    FROM rentals r
    JOIN renters ren ON ren.id = r.renter_id AND ren.organization_id = r.organization_id
    WHERE r.organization_id = v_org_id
      AND r.rental_date >= p_week_start
      AND r.rental_date <= p_week_end
      AND _rental_occupies_hall(r.booking_status, r.lifecycle)
      AND teacher_can_view_schedule_location(r.location_id)
  ) x;

  RETURN v_rows;
END;
$$;

COMMENT ON FUNCTION renter_cancel_bookings_from_date(uuid, date) IS
  'Staff/renter: cancel or delete all Mini App rentals for renter on and after from_date.';

REVOKE ALL ON FUNCTION _renter_slot_is_staff_cancellable(rentals, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_can_cancel_renter_from_date_row(rentals, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION renter_cancel_bookings_from_date(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION renter_cancel_bookings_from_date(uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION _renter_slot_is_staff_cancellable(rentals, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_can_cancel_renter_from_date_row(rentals, boolean) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
