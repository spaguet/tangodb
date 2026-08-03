-- Hall-rent stage 23: narrow rental slot create/edit for accountant (no full schedule.write).

BEGIN;

CREATE OR REPLACE FUNCTION member_can_create_rental()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT member_can_manage_rentals()
    OR (current_member_role() = 'accountant' AND can_read_financial());
$$;

REVOKE ALL ON FUNCTION member_can_create_rental() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_can_create_rental() TO authenticated, service_role;

-- create_rental: gate only (body from stage 13)
CREATE OR REPLACE FUNCTION create_rental(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_idempotency_key text := NULLIF(trim(p_payload ->> 'idempotency_key'), '');
  v_existing rentals%ROWTYPE;
  v_rental_id uuid;
  v_date date;
  v_time_start text;
  v_time_end text;
  v_location_id uuid;
  v_renter_id uuid;
  v_tariff_id uuid := NULLIF(p_payload ->> 'tariff_id', '')::uuid;
  v_fixed_amount numeric;
  v_calculated_amount numeric;
  v_override_amount numeric;
  v_override_reason text;
  v_adjustment numeric := 0;
  v_final_amount numeric;
  v_currency text;
  v_conflicts jsonb;
  v_conflict jsonb;
  v_pricing jsonb;
  v_tariff_type text;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT member_can_create_rental() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.forbidden');
  END IF;

  IF v_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM rentals r
    WHERE r.organization_id = v_org_id AND r.idempotency_key = v_idempotency_key;

    IF FOUND THEN
      RETURN jsonb_build_object('success', true, 'rental_id', v_existing.id, 'already_applied', true);
    END IF;
  END IF;

  v_date := (p_payload ->> 'rental_date')::date;
  v_time_start := normalize_hhmm(p_payload ->> 'time_start');
  v_time_end := normalize_hhmm(p_payload ->> 'time_end');
  v_location_id := (p_payload ->> 'location_id')::uuid;
  v_renter_id := (p_payload ->> 'renter_id')::uuid;
  v_fixed_amount := COALESCE((p_payload ->> 'fixed_amount')::numeric, 0);
  v_currency := COALESCE(NULLIF(p_payload ->> 'currency', ''), 'RUB');

  IF v_date IS NULL OR v_location_id IS NULL OR v_renter_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.fieldsInvalid');
  END IF;

  IF _hhmm_to_minutes(v_time_end) <= _hhmm_to_minutes(v_time_start) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.timeRangeInvalid');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM locations l WHERE l.id = v_location_id AND l.organization_id = v_org_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.locationInvalid');
  END IF;

  IF NOT _renter_is_bookable(v_renter_id, v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.renterInvalid');
  END IF;

  IF v_tariff_id IS NOT NULL THEN
    v_pricing := _calculate_rental_pricing(v_tariff_id, v_org_id, v_date, v_time_start, v_time_end);
    IF NOT COALESCE((v_pricing ->> 'success')::boolean, false) THEN
      RETURN v_pricing;
    END IF;
    v_calculated_amount := (v_pricing ->> 'calculated_amount')::numeric;
    v_fixed_amount := v_calculated_amount;
    v_currency := v_pricing ->> 'currency';
    v_tariff_type := v_pricing ->> 'tariff_type';

    IF (p_payload ? 'fixed_amount') THEN
      v_override_amount := (p_payload ->> 'fixed_amount')::numeric;
      IF v_override_amount IS NOT NULL AND v_override_amount <> v_calculated_amount THEN
        IF NOT member_can_record_rental_payment() THEN
          RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
        END IF;
        v_override_reason := NULLIF(trim(p_payload ->> 'amount_override_reason'), '');
        IF v_override_reason IS NULL THEN
          RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.amountOverrideReasonRequired');
        END IF;
        v_adjustment := v_override_amount - v_calculated_amount;
        v_fixed_amount := v_override_amount;
      END IF;
    END IF;
  END IF;

  IF v_fixed_amount < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.amountInvalid');
  END IF;

  IF v_fixed_amount > 0 AND NOT member_can_record_rental_payment() AND v_tariff_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
  END IF;

  v_final_amount := CASE WHEN v_tariff_id IS NOT NULL THEN v_fixed_amount ELSE NULL END;

  v_conflicts := preview_rental_conflicts(v_date, v_time_start, v_time_end, v_location_id, NULL);
  IF NOT COALESCE((v_conflicts ->> 'success')::boolean, false) THEN
    RETURN v_conflicts;
  END IF;

  IF jsonb_array_length(COALESCE(v_conflicts -> 'conflicts', '[]'::jsonb)) > 0 THEN
    SELECT value INTO v_conflict FROM jsonb_array_elements(v_conflicts -> 'conflicts') LIMIT 1;
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.conflict', 'conflict', v_conflict);
  END IF;

  PERFORM pg_advisory_xact_lock(_rental_location_lock_key(v_org_id, v_location_id, v_date));

  IF schedule_location_has_conflict(v_org_id, v_date, v_time_start, v_time_end, v_location_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.conflict');
  END IF;

  INSERT INTO rentals (
    organization_id, location_id, rental_date, time_start, time_end,
    renter_id, purpose, internal_comment, fixed_amount, currency,
    tariff_id, tariff_type, tariff_snapshot, pricing_breakdown,
    calculated_amount, adjustment_amount, final_amount,
    idempotency_key, created_by
  )
  VALUES (
    v_org_id, v_location_id, v_date, v_time_start, v_time_end,
    v_renter_id,
    NULLIF(trim(p_payload ->> 'purpose'), ''),
    NULLIF(trim(p_payload ->> 'internal_comment'), ''),
    v_fixed_amount, v_currency,
    v_tariff_id,
    v_tariff_type,
    CASE WHEN v_tariff_id IS NOT NULL THEN v_pricing -> 'tariff_snapshot' ELSE NULL END,
    CASE WHEN v_tariff_id IS NOT NULL THEN v_pricing -> 'breakdown' ELSE NULL END,
    CASE WHEN v_tariff_id IS NOT NULL THEN v_calculated_amount ELSE NULL END,
    CASE WHEN v_tariff_id IS NOT NULL THEN v_adjustment ELSE 0 END,
    v_final_amount,
    v_idempotency_key, v_member_id
  )
  RETURNING id INTO v_rental_id;

  IF COALESCE((p_payload ->> 'initial_payment')::numeric, 0) > 0 THEN
    IF NOT member_can_record_rental_payment() THEN
      RAISE EXCEPTION 'schedule.rental.financeForbidden' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO rental_payments (
      organization_id, rental_id, amount, currency, method, method_comment, idempotency_key, created_by
    )
    VALUES (
      v_org_id, v_rental_id, (p_payload ->> 'initial_payment')::numeric, v_currency,
      COALESCE(NULLIF(p_payload ->> 'payment_method', ''), 'cash'),
      NULLIF(trim(p_payload ->> 'payment_comment'), ''),
      CASE WHEN v_idempotency_key IS NOT NULL THEN v_idempotency_key || ':payment' END,
      v_member_id
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'rental_id', v_rental_id);
EXCEPTION
  WHEN unique_violation THEN
    IF v_idempotency_key IS NOT NULL THEN
      SELECT id INTO v_rental_id FROM rentals WHERE organization_id = v_org_id AND idempotency_key = v_idempotency_key;
      IF v_rental_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', true, 'rental_id', v_rental_id, 'already_applied', true);
      END IF;
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.duplicate');
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- update_rental slot fields: accountant path
CREATE OR REPLACE FUNCTION update_rental(p_rental_id uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_rental rentals%ROWTYPE;
  v_date date;
  v_time_start text;
  v_time_end text;
  v_location_id uuid;
  v_renter_id uuid;
  v_fixed_amount numeric;
  v_paid numeric;
  v_conflicts jsonb;
  v_conflict jsonb;
  v_amount_changed boolean := false;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.orgReadOnly');
  END IF;

  IF NOT member_can_create_rental() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.forbidden');
  END IF;

  SELECT * INTO v_rental
  FROM rentals r
  WHERE r.id = p_rental_id AND r.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.notFound');
  END IF;

  IF v_rental.booking_status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.alreadyCancelled');
  END IF;

  v_date := COALESCE((p_payload ->> 'rental_date')::date, v_rental.rental_date);
  v_time_start := COALESCE(normalize_hhmm(p_payload ->> 'time_start'), v_rental.time_start);
  v_time_end := COALESCE(normalize_hhmm(p_payload ->> 'time_end'), v_rental.time_end);
  v_location_id := COALESCE((p_payload ->> 'location_id')::uuid, v_rental.location_id);
  v_renter_id := COALESCE((p_payload ->> 'renter_id')::uuid, v_rental.renter_id);

  IF _hhmm_to_minutes(v_time_end) <= _hhmm_to_minutes(v_time_start) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.timeRangeInvalid');
  END IF;

  IF NOT _renter_is_bookable(v_renter_id, v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.renterInvalid');
  END IF;

  v_fixed_amount := v_rental.fixed_amount;
  IF p_payload ? 'fixed_amount' THEN
    IF NOT member_can_adjust_rental_amount() THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
    END IF;
    v_fixed_amount := COALESCE((p_payload ->> 'fixed_amount')::numeric, 0);
    IF v_fixed_amount < 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.amountInvalid');
    END IF;
    v_paid := _rental_paid_total(p_rental_id, v_org_id);
    IF v_paid > v_fixed_amount THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.paidExceedsFixed');
    END IF;
    v_amount_changed := v_fixed_amount IS DISTINCT FROM v_rental.fixed_amount
      OR v_fixed_amount IS DISTINCT FROM v_rental.final_amount;
  END IF;

  v_conflicts := preview_rental_conflicts(v_date, v_time_start, v_time_end, v_location_id, p_rental_id);
  IF NOT COALESCE((v_conflicts ->> 'success')::boolean, false) THEN
    RETURN v_conflicts;
  END IF;

  IF jsonb_array_length(COALESCE(v_conflicts -> 'conflicts', '[]'::jsonb)) > 0 THEN
    SELECT value INTO v_conflict FROM jsonb_array_elements(v_conflicts -> 'conflicts') LIMIT 1;
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.conflict', 'conflict', v_conflict);
  END IF;

  PERFORM pg_advisory_xact_lock(_rental_location_lock_key(v_org_id, v_location_id, v_date));

  IF schedule_location_has_conflict(v_org_id, v_date, v_time_start, v_time_end, v_location_id, NULL, NULL, p_rental_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.conflict');
  END IF;

  UPDATE rentals
  SET
    rental_date = v_date,
    time_start = v_time_start,
    time_end = v_time_end,
    location_id = v_location_id,
    renter_id = v_renter_id,
    purpose = CASE WHEN p_payload ? 'purpose' THEN NULLIF(trim(p_payload ->> 'purpose'), '') ELSE purpose END,
    internal_comment = CASE
      WHEN p_payload ? 'internal_comment' AND member_can_see_rental_sensitive()
        THEN NULLIF(trim(p_payload ->> 'internal_comment'), '')
      ELSE internal_comment
    END,
    fixed_amount = CASE WHEN p_payload ? 'fixed_amount' THEN v_fixed_amount ELSE fixed_amount END,
    final_amount = CASE
      WHEN p_payload ? 'fixed_amount' THEN v_fixed_amount
      ELSE final_amount
    END,
    adjustment_amount = CASE
      WHEN p_payload ? 'fixed_amount' AND v_amount_changed
        THEN v_fixed_amount - COALESCE(calculated_amount, _rental_effective_amount(v_rental.fixed_amount, v_rental.final_amount))
      ELSE adjustment_amount
    END,
    currency = COALESCE(NULLIF(p_payload ->> 'currency', ''), currency),
    updated_at = now()
  WHERE id = p_rental_id;

  RETURN jsonb_build_object('success', true, 'rental_id', p_rental_id);
END;
$$;

-- Conflict preview: allow accountant (finance.read) without operational schedule read
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
      'client_display', COALESCE(p.client_display, '')
    ))
    FROM personal_lessons p
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

-- cancel_rental: accountant can cancel mistaken bookings (gate only)
CREATE OR REPLACE FUNCTION cancel_rental(
  p_rental_id uuid,
  p_reason text,
  p_financial_action text DEFAULT 'none',
  p_penalty_amount numeric DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_rental rentals%ROWTYPE;
  v_fin_result jsonb;
  v_key text := NULLIF(trim(p_idempotency_key), '');
  v_cached jsonb;
  v_fingerprint text;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT member_can_create_rental() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.forbidden');
  END IF;

  IF NULLIF(trim(p_reason), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.cancelReasonRequired');
  END IF;

  IF NOT _rental_cancel_financial_action_valid(COALESCE(p_financial_action, 'none')) THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.cancel.financialActionInvalid');
  END IF;

  v_fingerprint := md5(
    coalesce(p_rental_id::text, '') || '|cancel_rental|' ||
    coalesce(p_financial_action, 'none') || '|' ||
    coalesce(p_penalty_amount::text, '') || '|' ||
    trim(p_reason)
  );

  IF v_key IS NOT NULL THEN
    v_cached := check_operation_idempotency(v_org_id, 'cancel_rental', v_key::uuid, v_fingerprint);
    IF v_cached IS NOT NULL THEN
      IF (v_cached ->> 'success')::boolean IS NOT TRUE AND v_cached ->> 'error_code' = 'idempotency_conflict' THEN
        RETURN v_cached;
      END IF;
      RETURN v_cached || jsonb_build_object('already_applied', true);
    END IF;
  END IF;

  SELECT * INTO v_rental
  FROM rentals r
  WHERE r.id = p_rental_id AND r.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.notFound');
  END IF;

  IF v_rental.booking_status = 'cancelled' THEN
    RETURN jsonb_build_object('success', true, 'already_applied', true);
  END IF;

  v_fin_result := _apply_rental_cancellation_financial(
    v_org_id,
    v_member_id,
    p_rental_id,
    COALESCE(p_financial_action, 'none'),
    p_penalty_amount,
    trim(p_reason),
    v_key
  );

  IF (v_fin_result ->> 'success')::boolean IS NOT TRUE THEN
    RETURN v_fin_result;
  END IF;

  UPDATE rentals
  SET
    booking_status = 'cancelled',
    cancelled_at = now(),
    cancelled_reason = trim(p_reason),
    cancelled_by = v_member_id,
    updated_at = now()
  WHERE id = p_rental_id;

  v_fin_result := v_fin_result || jsonb_build_object(
    'success', true,
    'rental_id', p_rental_id
  );

  IF v_key IS NOT NULL THEN
    PERFORM store_operation_idempotency(v_org_id, 'cancel_rental', v_key::uuid, v_fingerprint, v_fin_result);
  END IF;

  RETURN v_fin_result;
END;
$$;

COMMIT;
