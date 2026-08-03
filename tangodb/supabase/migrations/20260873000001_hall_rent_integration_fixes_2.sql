-- Integration fixes: preview_rental_conflicts client_display join;
-- cancellation advance insert without non-existent rental_advances.notes.

BEGIN;

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
      AND s.valid_from <= p_date
      AND (s.valid_to IS NULL OR s.valid_to >= p_date)
      AND schedule_time_ranges_overlap(s.time, s.time_end, v_time_start, v_time_end)
  ), '[]'::jsonb);

  v_conflicts := v_conflicts || COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'kind', 'personal',
      'lesson_id', p.id,
      'occurrence_date', p.date,
      'time_start', p.time_start,
      'time_end', p.time_end,
      'location_id', p.location_id,
      'client_display', COALESCE(
        NULLIF(trim(concat_ws(' ', c1.first_name, c1.last_name)), ''),
        ''
      )
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
      AND r.booking_status = 'confirmed'
      AND r.id IS DISTINCT FROM p_exclude_rental_id
      AND schedule_time_ranges_overlap(r.time_start, r.time_end, v_time_start, v_time_end)
  ), '[]'::jsonb);

  RETURN jsonb_build_object('success', true, 'conflicts', v_conflicts);
END;
$$;

CREATE OR REPLACE FUNCTION _apply_rental_cancellation_financial(
  p_org_id uuid,
  p_member_id uuid,
  p_rental_id uuid,
  p_financial_action text,
  p_penalty_amount numeric,
  p_reason text,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_paid numeric;
  v_effective numeric;
  v_final numeric;
  v_storno_result jsonb;
  v_advance_id uuid;
  v_refunded numeric;
  v_key text := NULLIF(trim(p_idempotency_key), '');
  v_today date;
  v_rental rentals%ROWTYPE;
BEGIN
  SELECT * INTO v_rental
  FROM rentals r
  WHERE r.id = p_rental_id AND r.organization_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.notFound');
  END IF;

  IF NOT _rental_cancel_financial_action_valid(p_financial_action) THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.cancel.financialActionInvalid');
  END IF;

  v_paid := _rental_paid_total(v_rental.id, p_org_id);
  v_effective := _rental_effective_amount(v_rental.fixed_amount, v_rental.final_amount);

  IF p_financial_action IN ('refund', 'transfer_to_advance') THEN
    IF NOT member_can_correct_payments() THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
    END IF;
    IF v_paid <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'rental.cancel.noPaymentsToRefund');
    END IF;
  END IF;

  IF p_financial_action = 'none' AND v_paid > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.cancel.paidRequiresRefundOrAdvance');
  END IF;

  IF p_financial_action = 'refund' THEN
    v_storno_result := _storno_all_rental_payments_for_cancel(
      p_org_id, p_member_id, v_rental.id,
      'cancellation_refund', p_reason,
      COALESCE(v_key, v_rental.id::text) || ':cancel_refund'
    );
    IF (v_storno_result ->> 'success')::boolean IS NOT TRUE THEN
      RETURN v_storno_result;
    END IF;
    v_refunded := COALESCE((v_storno_result ->> 'refunded_total')::numeric, 0);

    UPDATE rentals
    SET final_amount = 0, fixed_amount = 0, adjustment_amount = 0, updated_at = now()
    WHERE id = v_rental.id AND organization_id = p_org_id;

  ELSIF p_financial_action = 'transfer_to_advance' THEN
    v_storno_result := _storno_all_rental_payments_for_cancel(
      p_org_id, p_member_id, v_rental.id,
      'cancellation_advance', p_reason,
      COALESCE(v_key, v_rental.id::text) || ':cancel_advance_storno'
    );
    IF (v_storno_result ->> 'success')::boolean IS NOT TRUE THEN
      RETURN v_storno_result;
    END IF;
    v_refunded := COALESCE((v_storno_result ->> 'refunded_total')::numeric, 0);

    IF v_refunded <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'rental.cancel.noPaymentsToRefund');
    END IF;

    v_today := _org_local_date(p_org_id);

    IF v_key IS NOT NULL AND EXISTS (
      SELECT 1 FROM rental_advances ra
      WHERE ra.organization_id = p_org_id AND ra.idempotency_key = v_key || ':advance'
    ) THEN
      SELECT id INTO v_advance_id
      FROM rental_advances
      WHERE organization_id = p_org_id AND idempotency_key = v_key || ':advance';
    ELSE
      INSERT INTO rental_advances (
        organization_id, renter_id, amount, currency, method,
        idempotency_key, created_by, operation_date
      )
      VALUES (
        p_org_id,
        v_rental.renter_id,
        v_refunded,
        COALESCE(v_rental.currency, 'RUB'),
        'other',
        CASE WHEN v_key IS NOT NULL THEN v_key || ':advance' ELSE NULL END,
        p_member_id,
        v_today
      )
      RETURNING id INTO v_advance_id;
    END IF;

    UPDATE rentals
    SET final_amount = 0, fixed_amount = 0, adjustment_amount = 0, updated_at = now()
    WHERE id = v_rental.id AND organization_id = p_org_id;

  ELSIF p_financial_action = 'none' THEN
    UPDATE rentals
    SET final_amount = 0, fixed_amount = 0, adjustment_amount = 0, updated_at = now()
    WHERE id = v_rental.id AND organization_id = p_org_id;

  ELSIF p_financial_action = 'full_penalty' THEN
    v_final := v_effective;
    UPDATE rentals
    SET final_amount = v_final, fixed_amount = v_final, updated_at = now()
    WHERE id = v_rental.id AND organization_id = p_org_id;

  ELSIF p_financial_action = 'partial_penalty' THEN
    IF p_penalty_amount IS NULL OR p_penalty_amount <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'rental.series.penaltyInvalid');
    END IF;
    UPDATE rentals
    SET final_amount = p_penalty_amount, fixed_amount = p_penalty_amount, updated_at = now()
    WHERE id = v_rental.id AND organization_id = p_org_id;

  END IF;

  UPDATE rentals
  SET
    cancel_financial_action = p_financial_action,
    cancel_penalty_amount = CASE
      WHEN p_financial_action = 'partial_penalty' THEN p_penalty_amount
      WHEN p_financial_action = 'full_penalty' THEN v_effective
      ELSE NULL
    END,
    updated_at = now()
  WHERE id = v_rental.id AND organization_id = p_org_id;

  RETURN jsonb_build_object(
    'success', true,
    'financial_action', p_financial_action,
    'paid_total', _rental_paid_total(v_rental.id, p_org_id),
    'effective_amount', _rental_effective_amount(
      (SELECT fixed_amount FROM rentals WHERE id = v_rental.id AND organization_id = p_org_id),
      (SELECT final_amount FROM rentals WHERE id = v_rental.id AND organization_id = p_org_id)
    ),
    'advance_id', v_advance_id,
    'refunded_total', v_refunded
  );
END;
$$;

COMMIT;
