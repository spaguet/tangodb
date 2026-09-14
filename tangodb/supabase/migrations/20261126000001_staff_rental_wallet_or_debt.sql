-- Staff CRM rentals (Аренда / серия): always attach Mini App wallet when eligible.
-- Enough available → 50% reserve (existing FIFO). Not enough → Mini App debt for full cost
-- (not cashier uninvoiced, not a 24h hold that auto-deletes).
-- Occupancy ignores terminal Mini App lifecycles even if booking_status is stale.
-- Cashier uninvoiced / accrual skip channel=miniapp (R1a leftover).

BEGIN;

CREATE OR REPLACE FUNCTION _rental_occupies_hall(p_booking_status text, p_lifecycle text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_booking_status = 'confirmed'
     AND COALESCE(p_lifecycle, '') NOT IN ('cancelled', 'auto_deleted', 'hold_deleted');
$$;

COMMENT ON FUNCTION _rental_occupies_hall(text, text) IS
  'Hall occupancy: confirmed and not a terminal Mini App lifecycle.';

-- =============================================================================
-- Occupancy: preview / write / Mini App busy / schedule week
-- =============================================================================

CREATE OR REPLACE FUNCTION preview_rental_conflicts(
  p_date date,
  p_time_start text,
  p_time_end text,
  p_location_id uuid,
  p_exclude_rental_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_time_start text;
  v_time_end text;
  v_dow integer;
  v_conflicts jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT (
    can_read_operational()
    OR current_member_role() = 'teacher'
    OR can_read_financial()
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF p_date IS NULL OR p_time_start IS NULL OR p_time_end IS NULL OR p_location_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.fieldsInvalid');
  END IF;

  v_time_start := normalize_hhmm(p_time_start);
  v_time_end := normalize_hhmm(p_time_end);
  v_dow := EXTRACT(ISODOW FROM p_date)::integer;

  IF _hhmm_to_minutes(v_time_end) <= _hhmm_to_minutes(v_time_start) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.timeRangeInvalid');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM locations l
    WHERE l.id = p_location_id AND l.organization_id = v_org_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.locationInvalid');
  END IF;

  IF NOT teacher_can_view_schedule_location(p_location_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  v_conflicts := v_conflicts || COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'kind', 'group',
      'slot_id', s.id,
      'occurrence_date', p_date,
      'time_start', s.time,
      'time_end', s.time_end,
      'location_id', s.location_id,
      'group_name', COALESCE(s.group_name, '')
    ))
    FROM schedule_slots s
    WHERE s.organization_id = v_org_id
      AND s.day_of_week = v_dow
      AND s.location_id IS NOT DISTINCT FROM p_location_id
      AND _schedule_slot_active_on_date(s.valid_from, s.valid_to, p_date)
      AND schedule_time_ranges_overlap(s.time, s.time_end, v_time_start, v_time_end)
      AND NOT EXISTS (
        SELECT 1
        FROM schedule_occurrence_cancellations soc
        WHERE soc.organization_id = v_org_id
          AND soc.slot_id = s.id
          AND soc.occurrence_date = p_date
      )
  ), '[]'::jsonb);

  v_conflicts := v_conflicts || COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'kind', 'personal',
      'lesson_id', p.id,
      'occurrence_date', p.date,
      'time_start', p.time_start,
      'time_end', p.time_end,
      'location_id', p.location_id,
      'client_display', CASE
        WHEN can_read_operational() THEN COALESCE(
          NULLIF(trim(concat_ws(' ', c1.first_name, c1.last_name)), ''),
          ''
        )
        WHEN current_member_role() = 'teacher'
          AND p.teacher_member_id IS NOT DISTINCT FROM auth_member_id()
        THEN COALESCE(
          NULLIF(trim(concat_ws(' ', c1.first_name, c1.last_name)), ''),
          ''
        )
        ELSE ''
      END
    ))
    FROM personal_lessons p
    LEFT JOIN clients c1
      ON c1.organization_id = p.organization_id AND c1.id = p.client_id1
    WHERE p.organization_id = v_org_id
      AND p.date = p_date
      AND p.cancelled_at IS NULL
      AND p.location_id IS NOT DISTINCT FROM p_location_id
      AND schedule_time_ranges_overlap(p.time_start, p.time_end, v_time_start, v_time_end)
  ), '[]'::jsonb);

  v_conflicts := v_conflicts || COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'kind', 'event',
      'event_id', ce.id,
      'session_id', ces.id,
      'occurrence_date', ces.session_date,
      'time_start', ces.time_start,
      'time_end', ces.time_end,
      'location_id', ces.location_id,
      'title', ce.title
    ))
    FROM calendar_event_sessions ces
    JOIN calendar_events ce ON ce.id = ces.event_id AND ce.organization_id = ces.organization_id
    WHERE ces.organization_id = v_org_id
      AND ces.session_date = p_date
      AND ces.location_id IS NOT DISTINCT FROM p_location_id
      AND schedule_time_ranges_overlap(ces.time_start, ces.time_end, v_time_start, v_time_end)
  ), '[]'::jsonb);

  v_conflicts := v_conflicts || COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'kind', 'rental',
      'rental_id', r.id,
      'occurrence_date', r.rental_date,
      'time_start', r.time_start,
      'time_end', r.time_end,
      'location_id', r.location_id,
      'purpose', COALESCE(r.purpose, '')
    ))
    FROM rentals r
    WHERE r.organization_id = v_org_id
      AND r.rental_date = p_date
      AND r.location_id IS NOT DISTINCT FROM p_location_id
      AND _rental_occupies_hall(r.booking_status, r.lifecycle)
      AND r.id IS DISTINCT FROM p_exclude_rental_id
      AND schedule_time_ranges_overlap(r.time_start, r.time_end, v_time_start, v_time_end)
  ), '[]'::jsonb);

  RETURN jsonb_build_object('success', true, 'conflicts', v_conflicts);
END;
$$;

CREATE OR REPLACE FUNCTION schedule_location_has_conflict(
  p_org_id uuid,
  p_date date,
  p_time_start text,
  p_time_end text,
  p_location_id uuid,
  p_exclude_slot_id uuid DEFAULT NULL,
  p_exclude_event_id uuid DEFAULT NULL,
  p_exclude_rental_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_time_start text;
  v_time_end text;
  v_dow integer;
BEGIN
  v_time_start := normalize_hhmm(p_time_start);
  v_time_end := normalize_hhmm(p_time_end);

  IF _hhmm_to_minutes(v_time_end) <= _hhmm_to_minutes(v_time_start) THEN
    RETURN true;
  END IF;

  v_dow := EXTRACT(ISODOW FROM p_date)::integer;

  IF EXISTS (
    SELECT 1
    FROM personal_lessons p
    WHERE p.organization_id = p_org_id
      AND p.date = p_date
      AND p.cancelled_at IS NULL
      AND p.location_id IS NOT DISTINCT FROM p_location_id
      AND schedule_time_ranges_overlap(p.time_start, p.time_end, v_time_start, v_time_end)
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM schedule_slots s
    WHERE s.organization_id = p_org_id
      AND s.day_of_week = v_dow
      AND s.location_id IS NOT DISTINCT FROM p_location_id
      AND s.id IS DISTINCT FROM p_exclude_slot_id
      AND _schedule_slot_active_on_date(s.valid_from, s.valid_to, p_date)
      AND schedule_time_ranges_overlap(s.time, s.time_end, v_time_start, v_time_end)
      AND NOT EXISTS (
        SELECT 1
        FROM schedule_occurrence_cancellations soc
        WHERE soc.organization_id = p_org_id
          AND soc.slot_id = s.id
          AND soc.occurrence_date = p_date
      )
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM calendar_event_sessions ces
    JOIN calendar_events ce ON ce.id = ces.event_id AND ce.organization_id = ces.organization_id
    WHERE ces.organization_id = p_org_id
      AND ces.session_date = p_date
      AND ces.location_id IS NOT DISTINCT FROM p_location_id
      AND ce.id IS DISTINCT FROM p_exclude_event_id
      AND schedule_time_ranges_overlap(ces.time_start, ces.time_end, v_time_start, v_time_end)
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM rentals r
    WHERE r.organization_id = p_org_id
      AND r.rental_date = p_date
      AND r.location_id IS NOT DISTINCT FROM p_location_id
      AND _rental_occupies_hall(r.booking_status, r.lifecycle)
      AND r.id IS DISTINCT FROM p_exclude_rental_id
      AND schedule_time_ranges_overlap(r.time_start, r.time_end, v_time_start, v_time_end)
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION _renter_location_slot_busy(
  p_org_id uuid,
  p_date date,
  p_time_start text,
  p_time_end text,
  p_location_id uuid,
  p_exclude_rental_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_time_start text;
  v_time_end text;
  v_dow integer;
BEGIN
  v_time_start := normalize_hhmm(p_time_start);
  v_time_end := normalize_hhmm(p_time_end);

  IF _hhmm_to_minutes(v_time_end) <= _hhmm_to_minutes(v_time_start) THEN
    RETURN true;
  END IF;

  v_dow := EXTRACT(ISODOW FROM p_date)::integer;

  IF EXISTS (
    SELECT 1
    FROM personal_lessons p
    WHERE p.organization_id = p_org_id
      AND p.date = p_date
      AND p.cancelled_at IS NULL
      AND p.location_id IS NOT DISTINCT FROM p_location_id
      AND schedule_time_ranges_overlap(p.time_start, p.time_end, v_time_start, v_time_end)
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM schedule_slots s
    WHERE s.organization_id = p_org_id
      AND s.day_of_week = v_dow
      AND s.location_id IS NOT DISTINCT FROM p_location_id
      AND _schedule_slot_active_on_date(s.valid_from, s.valid_to, p_date)
      AND schedule_time_ranges_overlap(s.time, s.time_end, v_time_start, v_time_end)
      AND NOT EXISTS (
        SELECT 1
        FROM schedule_occurrence_cancellations soc
        WHERE soc.organization_id = p_org_id
          AND soc.slot_id = s.id
          AND soc.occurrence_date = p_date
      )
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM calendar_event_sessions ces
    JOIN calendar_events ce ON ce.id = ces.event_id AND ce.organization_id = ces.organization_id
    WHERE ces.organization_id = p_org_id
      AND ces.session_date = p_date
      AND ces.location_id IS NOT DISTINCT FROM p_location_id
      AND schedule_time_ranges_overlap(ces.time_start, ces.time_end, v_time_start, v_time_end)
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM rentals r
    WHERE r.organization_id = p_org_id
      AND r.rental_date = p_date
      AND r.location_id IS NOT DISTINCT FROM p_location_id
      AND _rental_occupies_hall(r.booking_status, r.lifecycle)
      AND r.id IS DISTINCT FROM p_exclude_rental_id
      AND schedule_time_ranges_overlap(r.time_start, r.time_end, v_time_start, v_time_end)
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
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
      END AS can_cancel_pack
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

-- =============================================================================
-- Cashier uninvoiced / accrual: Mini App is not cashier debt
-- =============================================================================

CREATE OR REPLACE FUNCTION get_renter_rental_finance(p_renter_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_invoice_debt numeric := 0;
  v_rental_debt numeric := 0;
  v_advances numeric := 0;
  v_deposits numeric := 0;
  v_overdue numeric := 0;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT can_read_financial() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
  END IF;

  SELECT COALESCE(sum(GREATEST(ri.total_amount - _rental_invoice_paid_total(ri.id, ri.organization_id), 0)), 0)
  INTO v_invoice_debt
  FROM rental_invoices ri
  WHERE ri.organization_id = v_org_id
    AND ri.renter_id = p_renter_id
    AND ri.status <> 'cancelled';

  SELECT COALESCE(sum(GREATEST(_rental_effective_amount(r.fixed_amount, r.final_amount) - _rental_paid_total(r.id, r.organization_id), 0)), 0)
  INTO v_rental_debt
  FROM rentals r
  WHERE r.organization_id = v_org_id
    AND r.renter_id = p_renter_id
    AND r.booking_status = 'confirmed'
    AND COALESCE(r.channel, 'cashier') = 'cashier'
    AND NOT _rental_is_in_active_invoice(r.id, v_org_id);

  SELECT COALESCE(sum(ra.amount - ra.allocated_amount), 0)
  INTO v_advances
  FROM rental_advances ra
  WHERE ra.organization_id = v_org_id AND ra.renter_id = p_renter_id;

  SELECT COALESCE(sum(rd.balance), 0)
  INTO v_deposits
  FROM rental_deposits rd
  WHERE rd.organization_id = v_org_id AND rd.renter_id = p_renter_id;

  SELECT COALESCE(sum(GREATEST(ri.total_amount - _rental_invoice_paid_total(ri.id, ri.organization_id), 0)), 0)
  INTO v_overdue
  FROM rental_invoices ri
  WHERE ri.organization_id = v_org_id
    AND ri.renter_id = p_renter_id
    AND ri.status IN ('invoiced', 'partially_paid', 'overdue')
    AND ri.due_date < current_date;

  RETURN jsonb_build_object(
    'success', true,
    'finance', jsonb_build_object(
      'invoice_debt', v_invoice_debt,
      'uninvoiced_rental_debt', v_rental_debt,
      'total_debt', v_invoice_debt + v_rental_debt,
      'advance_balance', v_advances,
      'deposit_balance', v_deposits,
      'overdue_amount', v_overdue
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION get_rental_accrual_report(
  p_period_start date,
  p_period_end date,
  p_renter_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_accrued numeric := 0;
  v_paid_direct numeric := 0;
  v_paid_invoice numeric := 0;
  v_advances_received numeric := 0;
  v_advances_allocated numeric := 0;
  v_invoice_debt numeric := 0;
  v_uninvoiced_debt numeric := 0;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT can_read_financial() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
  END IF;

  IF p_period_start IS NULL OR p_period_end IS NULL OR p_period_start > p_period_end THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.accrual.periodInvalid');
  END IF;

  SELECT COALESCE(sum(_rental_effective_amount(r.fixed_amount, r.final_amount)), 0)
  INTO v_accrued
  FROM rentals r
  WHERE r.organization_id = v_org_id
    AND r.booking_status = 'confirmed'
    AND COALESCE(r.channel, 'cashier') = 'cashier'
    AND r.rental_date >= p_period_start
    AND r.rental_date <= p_period_end
    AND (p_renter_id IS NULL OR r.renter_id = p_renter_id);

  SELECT COALESCE(sum(rp.amount), 0)
  INTO v_paid_direct
  FROM rental_payments rp
  JOIN rentals r ON r.id = rp.rental_id AND r.organization_id = rp.organization_id
  WHERE rp.organization_id = v_org_id
    AND COALESCE(r.channel, 'cashier') = 'cashier'
    AND rp.operation_date >= p_period_start
    AND rp.operation_date <= p_period_end
    AND (p_renter_id IS NULL OR r.renter_id = p_renter_id);

  SELECT COALESCE(sum(rip.amount), 0)
  INTO v_paid_invoice
  FROM rental_invoice_payments rip
  JOIN rental_invoices ri ON ri.id = rip.invoice_id AND ri.organization_id = rip.organization_id
  WHERE rip.organization_id = v_org_id
    AND rip.operation_date >= p_period_start
    AND rip.operation_date <= p_period_end
    AND (p_renter_id IS NULL OR ri.renter_id = p_renter_id);

  SELECT COALESCE(sum(ra.amount), 0)
  INTO v_advances_received
  FROM rental_advances ra
  WHERE ra.organization_id = v_org_id
    AND ra.operation_date >= p_period_start
    AND ra.operation_date <= p_period_end
    AND (p_renter_id IS NULL OR ra.renter_id = p_renter_id);

  SELECT COALESCE(sum(raa.amount), 0)
  INTO v_advances_allocated
  FROM rental_advance_allocations raa
  JOIN rental_advances ra ON ra.id = raa.advance_id AND ra.organization_id = raa.organization_id
  WHERE raa.organization_id = v_org_id
    AND raa.cancelled_at IS NULL
    AND (raa.allocated_at AT TIME ZONE COALESCE(_org_timezone(v_org_id), 'UTC'))::date >= p_period_start
    AND (raa.allocated_at AT TIME ZONE COALESCE(_org_timezone(v_org_id), 'UTC'))::date <= p_period_end
    AND (p_renter_id IS NULL OR ra.renter_id = p_renter_id);

  SELECT COALESCE(sum(GREATEST(ri.total_amount - _rental_invoice_paid_total(ri.id, ri.organization_id), 0)), 0)
  INTO v_invoice_debt
  FROM rental_invoices ri
  WHERE ri.organization_id = v_org_id
    AND ri.status <> 'cancelled'
    AND (p_renter_id IS NULL OR ri.renter_id = p_renter_id);

  SELECT COALESCE(sum(GREATEST(_rental_effective_amount(r.fixed_amount, r.final_amount) - _rental_paid_total(r.id, r.organization_id), 0)), 0)
  INTO v_uninvoiced_debt
  FROM rentals r
  WHERE r.organization_id = v_org_id
    AND r.booking_status = 'confirmed'
    AND COALESCE(r.channel, 'cashier') = 'cashier'
    AND NOT _rental_is_in_active_invoice(r.id, v_org_id)
    AND (p_renter_id IS NULL OR r.renter_id = p_renter_id);

  RETURN jsonb_build_object(
    'success', true,
    'report', jsonb_build_object(
      'period_start', p_period_start,
      'period_end', p_period_end,
      'renter_id', p_renter_id,
      'accrued_amount', v_accrued,
      'paid_direct', v_paid_direct,
      'paid_invoice', v_paid_invoice,
      'paid_total', v_paid_direct + v_paid_invoice,
      'advances_received', v_advances_received,
      'advances_allocated', v_advances_allocated,
      'invoice_debt', v_invoice_debt,
      'uninvoiced_debt', v_uninvoiced_debt,
      'total_debt', v_invoice_debt + v_uninvoiced_debt
    )
  );
END;
$$;

-- =============================================================================
-- Staff unpaid Mini App slot → debt; staff can release it before start
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_assign_staff_unpaid_slot_debt(p_rental_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_r rentals%ROWTYPE;
  v_cost numeric;
BEGIN
  SELECT * INTO v_r FROM rentals WHERE id = p_rental_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF v_r.channel IS DISTINCT FROM 'miniapp' THEN
    RETURN false;
  END IF;
  IF v_r.booking_status IS DISTINCT FROM 'confirmed' THEN
    RETURN false;
  END IF;
  IF v_r.lifecycle IS DISTINCT FROM 'awaiting_payment' THEN
    RETURN false;
  END IF;
  IF v_r.prepay_charged_at IS NOT NULL THEN
    RETURN false;
  END IF;
  IF v_r.created_by IS NULL THEN
    RETURN false;
  END IF;

  v_cost := COALESCE(_rental_effective_amount(v_r.fixed_amount, v_r.final_amount), 0);
  IF v_cost <= 0 THEN
    RETURN false;
  END IF;

  UPDATE rentals
  SET
    lifecycle = 'debt',
    debt_amount = v_cost,
    hold_expires_at = NULL,
    updated_at = now()
  WHERE id = p_rental_id
    AND channel = 'miniapp'
    AND lifecycle = 'awaiting_payment'
    AND prepay_charged_at IS NULL;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  PERFORM _renter_enqueue_debt_accrued(p_rental_id, v_cost);
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION _renter_attach_wallet_to_staff_cashier_rentals(p_rental_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_org uuid;
  v_renter uuid;
  v_sorted uuid[];
BEGIN
  IF p_rental_ids IS NULL OR coalesce(array_length(p_rental_ids, 1), 0) = 0 THEN
    RETURN;
  END IF;

  SELECT r.organization_id, r.renter_id
  INTO v_org, v_renter
  FROM rentals r
  WHERE r.id = p_rental_ids[1];

  IF v_org IS NULL OR v_renter IS NULL THEN
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(_renter_wallet_lock_key(v_org, v_renter));

  SELECT COALESCE(array_agg(r.id ORDER BY r.rental_date, r.time_start, r.created_at), '{}')
  INTO v_sorted
  FROM unnest(p_rental_ids) AS x(id)
  JOIN rentals r ON r.id = x.id
  WHERE r.organization_id = v_org
    AND r.renter_id = v_renter
    AND _renter_cashier_rental_wallet_eligible(r.id);

  IF v_sorted IS NULL OR coalesce(array_length(v_sorted, 1), 0) = 0 THEN
    RETURN;
  END IF;

  FOREACH v_id IN ARRAY v_sorted
  LOOP
    PERFORM _renter_promote_cashier_rental_to_miniapp(v_id);
  END LOOP;

  PERFORM _renter_apply_wallet(v_org, v_renter);

  FOREACH v_id IN ARRAY v_sorted
  LOOP
    PERFORM _renter_assign_staff_unpaid_slot_debt(v_id);
  END LOOP;
END;
$$;

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
  IF p_is_renter THEN
    RETURN false;
  END IF;
  IF p_r.lifecycle IS DISTINCT FROM 'debt' OR p_r.prepay_charged_at IS NOT NULL OR p_r.created_by IS NULL THEN
    RETURN false;
  END IF;
  v_start := _renter_slot_ts(p_r.organization_id, p_r.rental_date, p_r.time_start);
  RETURN now() < v_start;
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
  v_start timestamptz;
BEGIN
  SELECT * INTO v_r FROM rentals WHERE id = p_rental_id FOR UPDATE;
  IF NOT FOUND OR v_r.channel <> 'miniapp' THEN
    PERFORM _renter_raise('renter.booking.notCancellable');
  END IF;

  IF v_r.lifecycle = 'debt'
     AND v_r.prepay_charged_at IS NULL
     AND v_r.created_by IS NOT NULL THEN
    v_start := _renter_slot_ts(v_r.organization_id, v_r.rental_date, v_r.time_start);
    IF now() >= v_start THEN
      PERFORM _renter_raise('renter.cancel.notHold');
    END IF;
    UPDATE rentals
    SET
      booking_status = 'cancelled',
      lifecycle = 'hold_deleted',
      debt_amount = 0,
      cancelled_at = COALESCE(cancelled_at, now()),
      cancelled_reason = 'miniapp_hold_deleted',
      cancelled_by = p_member_id,
      updated_at = now()
    WHERE id = v_r.id
      AND channel = 'miniapp';
  ELSIF v_r.lifecycle IS DISTINCT FROM 'awaiting_payment' OR v_r.prepay_charged_at IS NOT NULL THEN
    PERFORM _renter_raise('renter.cancel.notHold');
  ELSE
    PERFORM _renter_mark_terminal(v_r.id, 'hold_deleted', 'miniapp_hold_deleted', p_member_id);
  END IF;

  IF NOT p_defer_wallet THEN
    PERFORM _renter_after_pack_slot_terminal(v_r.rental_series_id);
  END IF;

  IF NOT p_defer_wallet THEN
    PERFORM _renter_apply_wallet(v_r.organization_id, v_r.renter_id);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION _rental_occupies_hall(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_assign_staff_unpaid_slot_debt(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION _rental_occupies_hall(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION _renter_assign_staff_unpaid_slot_debt(uuid) TO service_role;

REVOKE ALL ON FUNCTION preview_rental_conflicts(date, text, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION preview_rental_conflicts(date, text, text, uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION get_rentals_for_schedule_week(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_rentals_for_schedule_week(date, date) TO authenticated;

REVOKE ALL ON FUNCTION get_renter_rental_finance(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_renter_rental_finance(uuid) TO authenticated;

REVOKE ALL ON FUNCTION get_rental_accrual_report(date, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_rental_accrual_report(date, date, uuid) TO authenticated;

REVOKE ALL ON FUNCTION _renter_attach_wallet_to_staff_cashier_rentals(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION _renter_attach_wallet_to_staff_cashier_rentals(uuid[]) TO service_role;

REVOKE ALL ON FUNCTION _renter_delete_hold_slot(uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION _renter_delete_hold_slot(uuid, uuid, boolean) TO service_role;

COMMENT ON FUNCTION _renter_attach_wallet_to_staff_cashier_rentals(uuid[]) IS
  'Promote eligible cashier slots to miniapp, FIFO-activate if the wallet covers 50%, otherwise Mini App debt for the full cost.';

-- =============================================================================
-- Backfill
-- =============================================================================

DO $$
DECLARE
  v_renter uuid;
  v_org uuid;
  v_ids uuid[];
  v_id uuid;
BEGIN
  FOR v_renter, v_org IN
    SELECT DISTINCT r.renter_id, r.organization_id
    FROM rentals r
    JOIN renters rt
      ON rt.id = r.renter_id
     AND rt.organization_id = r.organization_id
    WHERE rt.telegram_id IS NOT NULL
      AND (
        (r.channel = 'cashier' AND r.booking_status = 'confirmed')
        OR (r.channel = 'miniapp' AND r.lifecycle = 'awaiting_payment' AND r.created_by IS NOT NULL)
      )
  LOOP
    PERFORM pg_advisory_xact_lock(_renter_wallet_lock_key(v_org, v_renter));
    PERFORM _renter_apply_wallet(v_org, v_renter);

    SELECT COALESCE(array_agg(r.id), '{}')
    INTO v_ids
    FROM rentals r
    WHERE r.renter_id = v_renter
      AND r.organization_id = v_org
      AND r.channel = 'cashier'
      AND r.booking_status = 'confirmed';
    PERFORM _renter_attach_wallet_to_staff_cashier_rentals(v_ids);

    FOR v_id IN
      SELECT r.id
      FROM rentals r
      WHERE r.renter_id = v_renter
        AND r.organization_id = v_org
        AND r.channel = 'miniapp'
        AND r.lifecycle = 'awaiting_payment'
        AND r.created_by IS NOT NULL
        AND r.booking_status = 'confirmed'
    LOOP
      PERFORM _renter_assign_staff_unpaid_slot_debt(v_id);
    END LOOP;
  END LOOP;
END;
$$;

COMMIT;
