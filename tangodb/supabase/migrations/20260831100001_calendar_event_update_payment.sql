-- Update calendar event metadata and record post-creation payments (CRM scenario 3 follow-up)

BEGIN;

CREATE OR REPLACE FUNCTION _calendar_event_payment_status(
  p_income_amount numeric,
  p_paid_amount numeric
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN COALESCE(p_income_amount, 0) <= 0 AND COALESCE(p_paid_amount, 0) > 0 THEN 'paid'
    WHEN COALESCE(p_paid_amount, 0) <= 0 THEN 'unpaid'
    WHEN COALESCE(p_paid_amount, 0) >= COALESCE(p_income_amount, 0) THEN 'paid'
    ELSE 'partial'
  END;
$$;

CREATE OR REPLACE FUNCTION update_calendar_event(
  p_event_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_event calendar_events%ROWTYPE;
  v_title text;
  v_event_type text;
  v_income_amount numeric;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.orgReadOnly');
  END IF;

  IF NOT member_can_manage_calendar_events() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.event.forbidden');
  END IF;

  SELECT *
  INTO v_event
  FROM calendar_events ce
  WHERE ce.id = p_event_id
    AND ce.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.event.notFound');
  END IF;

  v_title := COALESCE(NULLIF(trim(p_payload ->> 'title'), ''), v_event.title);
  v_event_type := COALESCE(p_payload ->> 'event_type', v_event.event_type);

  IF v_event_type NOT IN ('master_class', 'open_lesson') THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.event.typeInvalid');
  END IF;

  v_income_amount := v_event.income_amount;
  IF p_payload ? 'income_amount' THEN
    IF NOT can_read_financial() THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.event.financeForbidden');
    END IF;
    v_income_amount := COALESCE((p_payload ->> 'income_amount')::numeric, 0);
    IF v_income_amount < 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.event.incomeInvalid');
    END IF;
    IF v_event.paid_amount > v_income_amount THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.event.paidExceedsIncome');
    END IF;
  END IF;

  UPDATE calendar_events
  SET
    title = v_title,
    event_type = v_event_type,
    comment = CASE
      WHEN p_payload ? 'comment' THEN NULLIF(trim(p_payload ->> 'comment'), '')
      ELSE comment
    END,
    guest_teacher = CASE
      WHEN p_payload ? 'guest_teacher' THEN NULLIF(trim(p_payload ->> 'guest_teacher'), '')
      ELSE guest_teacher
    END,
    organizer = CASE
      WHEN p_payload ? 'organizer' THEN NULLIF(trim(p_payload ->> 'organizer'), '')
      ELSE organizer
    END,
    planned_guest_count = CASE
      WHEN p_payload ? 'planned_guest_count' THEN (p_payload ->> 'planned_guest_count')::integer
      ELSE planned_guest_count
    END,
    actual_guest_count = CASE
      WHEN p_payload ? 'actual_guest_count' THEN (p_payload ->> 'actual_guest_count')::integer
      ELSE actual_guest_count
    END,
    income_amount = v_income_amount,
    payment_comment = CASE
      WHEN p_payload ? 'payment_comment' AND can_read_financial()
        THEN NULLIF(trim(p_payload ->> 'payment_comment'), '')
      ELSE payment_comment
    END,
    payment_status = _calendar_event_payment_status(v_income_amount, paid_amount),
    updated_at = now()
  WHERE id = p_event_id;

  RETURN jsonb_build_object('success', true, 'event_id', p_event_id);
END;
$$;

CREATE OR REPLACE FUNCTION record_calendar_event_payment(
  p_event_id uuid,
  p_amount numeric,
  p_method text DEFAULT 'cash',
  p_method_comment text DEFAULT NULL,
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
  v_event calendar_events%ROWTYPE;
  v_key text := NULLIF(trim(p_idempotency_key), '');
  v_existing other_income%ROWTYPE;
  v_payment_id uuid;
  v_new_paid numeric;
  v_new_status text;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.orgReadOnly');
  END IF;

  IF NOT can_read_financial() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.event.financeForbidden');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.event.paymentAmountInvalid');
  END IF;

  IF p_method NOT IN ('cash', 'transfer', 'card', 'other') THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.event.paymentMethodInvalid');
  END IF;

  IF v_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM other_income oi
    WHERE oi.organization_id = v_org_id
      AND oi.idempotency_key = v_key;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'payment_id', v_existing.id,
        'already_applied', true
      );
    END IF;
  END IF;

  SELECT *
  INTO v_event
  FROM calendar_events ce
  WHERE ce.id = p_event_id
    AND ce.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.event.notFound');
  END IF;

  IF v_event.payment_status = 'paid'
    AND COALESCE(v_event.income_amount, 0) > 0
    AND v_event.paid_amount >= v_event.income_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.event.alreadyPaid');
  END IF;

  v_new_paid := v_event.paid_amount + p_amount;

  IF COALESCE(v_event.income_amount, 0) > 0 AND v_new_paid > v_event.income_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.event.paidExceedsIncome');
  END IF;

  INSERT INTO other_income (
    organization_id,
    calendar_event_id,
    amount,
    currency,
    method,
    method_comment,
    idempotency_key,
    created_by
  )
  VALUES (
    v_org_id,
    p_event_id,
    p_amount,
    v_event.currency,
    p_method,
    NULLIF(trim(p_method_comment), ''),
    v_key,
    v_member_id
  )
  RETURNING id INTO v_payment_id;

  v_new_status := _calendar_event_payment_status(v_event.income_amount, v_new_paid);

  UPDATE calendar_events
  SET
    paid_amount = v_new_paid,
    payment_status = v_new_status,
    updated_at = now()
  WHERE id = p_event_id;

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'paid_amount', v_new_paid,
    'payment_status', v_new_status
  );
EXCEPTION
  WHEN unique_violation THEN
    IF v_key IS NOT NULL THEN
      SELECT id INTO v_payment_id
      FROM other_income
      WHERE organization_id = v_org_id AND idempotency_key = v_key;

      IF v_payment_id IS NOT NULL THEN
        RETURN jsonb_build_object(
          'success', true,
          'payment_id', v_payment_id,
          'already_applied', true
        );
      END IF;
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'schedule.event.duplicate');
END;
$$;

REVOKE ALL ON FUNCTION update_calendar_event(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_calendar_event(uuid, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION record_calendar_event_payment(uuid, numeric, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_calendar_event_payment(uuid, numeric, text, text, text) TO authenticated;

COMMIT;
