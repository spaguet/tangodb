-- S11 / H29, M44, M37: closed finance period on main cash RPCs.
-- storno_payment / correct_payment / update_payment_method unchanged (correction path).

BEGIN;

-- =============================================================================
-- Helpers: resolve operation date for in-place payment edits
-- =============================================================================

CREATE OR REPLACE FUNCTION _payment_operation_date(
  p_org_id uuid,
  p_payment payments
)
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT pl.date
      FROM personal_lessons pl
      WHERE pl.organization_id = p_org_id
        AND pl.id = p_payment.personal_lesson_id
    ),
    (
      SELECT sv.visit_date
      FROM single_visits sv
      WHERE sv.organization_id = p_org_id
        AND sv.id = p_payment.single_visit_id
    ),
    _org_local_date(p_org_id, p_payment.created_at)
  );
$$;

CREATE OR REPLACE FUNCTION _calendar_event_operation_date(p_org_id uuid, p_event_id uuid)
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT MIN(ces.session_date)
      FROM calendar_event_sessions ces
      WHERE ces.organization_id = p_org_id
        AND ces.event_id = p_event_id
    ),
    _org_local_date(p_org_id)
  );
$$;

REVOKE ALL ON FUNCTION _payment_operation_date(uuid, payments) FROM PUBLIC;
REVOKE ALL ON FUNCTION _calendar_event_operation_date(uuid, uuid) FROM PUBLIC;

-- =============================================================================
-- record_subscription_payment — org-local today
-- =============================================================================

CREATE OR REPLACE FUNCTION record_subscription_payment(
  p_subscription_id uuid,
  p_amount numeric,
  p_method text DEFAULT 'cash',
  p_method_comment text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL,
  p_venue_rule_acknowledged boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_status jsonb;
  v_result jsonb;
  v_cached jsonb;
  v_existing_payment_id uuid;
  v_fingerprint text := md5(concat_ws('|', p_subscription_id, p_amount, p_method, p_method_comment, p_venue_rule_acknowledged));
BEGIN
  v_cached := check_operation_idempotency(v_org_id, 'record_subscription_payment', p_idempotency_key, v_fingerprint);
  IF v_cached IS NOT NULL THEN
    IF v_cached ->> 'error_code' = 'idempotency_conflict'
      AND NOT COALESCE(p_venue_rule_acknowledged, false)
    THEN
      v_cached := check_operation_idempotency(
        v_org_id,
        'record_subscription_payment',
        p_idempotency_key,
        md5(
          coalesce(p_subscription_id::text, '') || '|' ||
          coalesce(p_amount::text, '') || '|' ||
          coalesce(p_method, '') || '|' ||
          coalesce(p_method_comment, '')
        )
      );
    END IF;
    IF v_cached ->> 'error_code' = 'idempotency_conflict' THEN RETURN v_cached; END IF;
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  IF _is_finance_period_closed(v_org_id, _org_local_date(v_org_id)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.error.periodClosed');
  END IF;

  v_status := venue_cost_status_for_org(v_org_id, current_date);
  IF COALESCE((v_status ->> 'acknowledgement_required')::boolean, false)
    AND NOT COALESCE(p_venue_rule_acknowledged, false)
  THEN
    RETURN jsonb_build_object(
      'success', false, 'error_code', 'venue_rule_ack_required',
      'error', 'venue_rule_ack_required', 'venue_rule_status', v_status
    );
  END IF;
  SELECT p.id INTO v_existing_payment_id
  FROM payments p
  WHERE p.organization_id = v_org_id
    AND p.subscription_id = p_subscription_id
    AND p.personal_lesson_id IS NULL
    AND p.single_visit_id IS NULL
    AND p.operation_kind = 'payment'
  LIMIT 1;
  v_result := _record_subscription_payment_before_venue_rules(
    p_subscription_id, p_amount, p_method, p_method_comment, p_idempotency_key
  );
  IF COALESCE((v_result ->> 'success')::boolean, false) THEN
    IF v_existing_payment_id IS NULL
      AND NOT COALESCE((v_result ->> 'already_applied')::boolean, false)
    THEN
      PERFORM store_venue_payment_ack_if_required(
        v_status, (v_result ->> 'payment_id')::uuid, 'record_subscription_payment', p_idempotency_key
      );
    END IF;
    PERFORM store_operation_idempotency(v_org_id, 'record_subscription_payment', p_idempotency_key, v_fingerprint, v_result);
  END IF;
  RETURN v_result;
END;
$$;

-- =============================================================================
-- record_personal_lesson_payment — lesson date
-- =============================================================================

CREATE OR REPLACE FUNCTION record_personal_lesson_payment(
  p_lesson_id uuid,
  p_amount numeric,
  p_method text DEFAULT 'cash',
  p_idempotency_key uuid DEFAULT NULL,
  p_venue_rule_acknowledged boolean DEFAULT false,
  p_price_id uuid DEFAULT NULL,
  p_tariff_units numeric DEFAULT NULL,
  p_tariff_duration_minutes integer DEFAULT NULL,
  p_tariff_price numeric DEFAULT NULL,
  p_tariff_label text DEFAULT NULL,
  p_lesson_duration_minutes integer DEFAULT NULL,
  p_client_id uuid DEFAULT NULL,
  p_charge_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_status jsonb;
  v_result jsonb;
  v_cached jsonb;
  v_existing_payment_id uuid;
  v_lesson_date date;
  v_fingerprint text := md5(concat_ws(
    '|',
    p_lesson_id,
    p_amount,
    p_method,
    p_venue_rule_acknowledged,
    p_price_id,
    p_tariff_units,
    p_client_id,
    p_charge_id
  ));
  v_legacy_fingerprint text := md5(
    coalesce(p_lesson_id::text, '') || '|' ||
    coalesce(p_amount::text, '') || '|' ||
    coalesce(p_method, '')
  );
BEGIN
  v_cached := check_operation_idempotency(
    v_org_id, 'record_personal_lesson_payment', p_idempotency_key, v_fingerprint
  );
  IF v_cached IS NOT NULL THEN
    IF v_cached ->> 'error_code' = 'idempotency_conflict'
      AND NOT COALESCE(p_venue_rule_acknowledged, false)
    THEN
      v_cached := check_operation_idempotency(
        v_org_id,
        'record_personal_lesson_payment',
        p_idempotency_key,
        v_legacy_fingerprint
      );
    END IF;
    IF v_cached ->> 'error_code' = 'idempotency_conflict' THEN
      RETURN v_cached;
    END IF;
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  SELECT pl.date INTO v_lesson_date
  FROM personal_lessons pl
  WHERE pl.id = p_lesson_id AND pl.organization_id = v_org_id;

  IF FOUND AND _is_finance_period_closed(v_org_id, v_lesson_date) THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.error.periodClosed');
  END IF;

  v_status := venue_cost_status_for_org(v_org_id, current_date);
  IF COALESCE((v_status ->> 'acknowledgement_required')::boolean, false)
    AND NOT COALESCE(p_venue_rule_acknowledged, false)
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'venue_rule_ack_required',
      'error', 'venue_rule_ack_required',
      'venue_rule_status', v_status
    );
  END IF;

  SELECT p.id INTO v_existing_payment_id
  FROM payments p
  WHERE p.organization_id = v_org_id
    AND p.personal_lesson_id = p_lesson_id
    AND p.operation_kind = 'payment'
    AND p.replaces_payment_id IS NULL
    AND payment_remaining_amount(v_org_id, p.id) > 0
  ORDER BY p.created_at
  LIMIT 1;

  v_result := _record_personal_lesson_payment_impl(
    p_lesson_id,
    p_amount,
    p_method,
    p_idempotency_key,
    p_price_id,
    p_tariff_units,
    p_tariff_duration_minutes,
    p_tariff_price,
    p_tariff_label,
    p_lesson_duration_minutes,
    p_client_id,
    p_charge_id
  );

  IF COALESCE((v_result ->> 'success')::boolean, false) THEN
    IF v_existing_payment_id IS NULL
      AND NOT COALESCE((v_result ->> 'already_applied')::boolean, false)
    THEN
      PERFORM store_venue_payment_ack_if_required(
        v_status,
        (v_result ->> 'payment_id')::uuid,
        'record_personal_lesson_payment',
        p_idempotency_key
      );
    END IF;
    PERFORM store_operation_idempotency(
      v_org_id,
      'record_personal_lesson_payment',
      p_idempotency_key,
      v_fingerprint,
      v_result
    );
  END IF;

  RETURN v_result;
END;
$$;

-- =============================================================================
-- record_single_visit — visit date
-- =============================================================================

CREATE OR REPLACE FUNCTION record_single_visit(
  p_visit_date date,
  p_schedule_slot_id uuid,
  p_client_id uuid,
  p_price_id uuid DEFAULT NULL,
  p_method text DEFAULT 'cash',
  p_idempotency_key uuid DEFAULT NULL,
  p_amount numeric DEFAULT NULL,
  p_venue_rule_acknowledged boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_status jsonb;
  v_result jsonb;
  v_cached jsonb;
  v_existing_payment_id uuid;
  v_fingerprint text := md5(concat_ws(
    '|', p_visit_date, p_schedule_slot_id, p_client_id, p_price_id, p_method, p_venue_rule_acknowledged, p_amount
  ));
BEGIN
  v_cached := check_operation_idempotency(v_org_id, 'record_single_visit', p_idempotency_key, v_fingerprint);
  IF v_cached IS NOT NULL THEN
    IF v_cached ->> 'error_code' = 'idempotency_conflict'
      AND NOT COALESCE(p_venue_rule_acknowledged, false)
    THEN
      v_cached := check_operation_idempotency(
        v_org_id,
        'record_single_visit',
        p_idempotency_key,
        md5(
          coalesce(p_visit_date::text, '') || '|' ||
          coalesce(p_schedule_slot_id::text, '') || '|' ||
          coalesce(p_client_id::text, '') || '|' ||
          coalesce(p_price_id::text, '') || '|' ||
          coalesce(p_method, '')
        )
      );
    END IF;
    IF v_cached ->> 'error_code' = 'idempotency_conflict' THEN RETURN v_cached; END IF;
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  IF _is_finance_period_closed(v_org_id, p_visit_date) THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.error.periodClosed');
  END IF;

  v_status := venue_cost_status_for_org(v_org_id, current_date);
  IF COALESCE((v_status ->> 'acknowledgement_required')::boolean, false)
    AND NOT COALESCE(p_venue_rule_acknowledged, false)
  THEN
    RETURN jsonb_build_object(
      'success', false, 'error_code', 'venue_rule_ack_required',
      'error', 'venue_rule_ack_required', 'venue_rule_status', v_status
    );
  END IF;
  SELECT p.id INTO v_existing_payment_id
  FROM single_visits sv
  JOIN payments p
    ON p.organization_id = sv.organization_id
   AND p.single_visit_id = sv.id
   AND p.operation_kind = 'payment'
   AND p.replaces_payment_id IS NULL
  WHERE sv.organization_id = v_org_id
    AND sv.visit_date = p_visit_date
    AND sv.schedule_slot_id = p_schedule_slot_id
    AND sv.client_id = p_client_id
    AND payment_remaining_amount(v_org_id, p.id) > 0
  LIMIT 1;
  v_result := _record_single_visit_before_venue_rules(
    p_visit_date, p_schedule_slot_id, p_client_id, p_price_id, p_method, p_idempotency_key, p_amount
  );
  IF COALESCE((v_result ->> 'success')::boolean, false) THEN
    IF v_existing_payment_id IS NULL
      AND NOT COALESCE((v_result ->> 'already_applied')::boolean, false)
    THEN
      PERFORM store_venue_payment_ack_if_required(
        v_status, (v_result ->> 'payment_id')::uuid, 'record_single_visit', p_idempotency_key
      );
    END IF;
    PERFORM post_teacher_pay_deduction_for_single_visit((v_result ->> 'visitId')::uuid, v_member_id);
    PERFORM store_operation_idempotency(v_org_id, 'record_single_visit', p_idempotency_key, v_fingerprint, v_result);
  END IF;
  RETURN v_result;
END;
$$;

-- =============================================================================
-- record_calendar_event_payment — earliest session date
-- =============================================================================

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
  v_operation_date date;
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

  v_operation_date := _calendar_event_operation_date(v_org_id, p_event_id);
  IF _is_finance_period_closed(v_org_id, v_operation_date) THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.error.periodClosed');
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

-- =============================================================================
-- finish_subscription_with_refund — org-local date; block client backdating into closed period
-- =============================================================================

CREATE OR REPLACE FUNCTION finish_subscription_with_refund(
  p_sub_id text,
  p_recipient_client_id uuid,
  p_amount numeric,
  p_method text DEFAULT 'cash',
  p_reason text DEFAULT NULL,
  p_status text DEFAULT 'completed',
  p_operation_date date DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL,
  p_calc_mode text DEFAULT 'pro_rata',
  p_single_visit_rate numeric DEFAULT NULL,
  p_single_visit_tariff_id uuid DEFAULT NULL,
  p_amount_override boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_sub subscriptions%ROWTYPE;
  v_sub_uuid uuid;
  v_existing subscription_refunds%ROWTYPE;
  v_payment payments%ROWTYPE;
  v_available numeric;
  v_recommended numeric;
  v_rounded_amount numeric;
  v_operation_date date;
  v_formula jsonb;
  v_refund_id uuid;
  v_calc_mode text;
  v_retained numeric;
  v_lessons_used int;
  v_amount_override boolean;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  IF NOT member_can_issue_refunds() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав');
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM subscription_refunds sr
    WHERE sr.organization_id = v_org_id
      AND sr.idempotency_key = p_idempotency_key;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'refundId', v_existing.id,
        'amount', v_existing.amount,
        'status', v_existing.status,
        'idempotentReplay', true
      );
    END IF;
  END IF;

  IF p_method NOT IN ('cash', 'transfer', 'card', 'other') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недопустимый способ возврата');
  END IF;

  IF p_status NOT IN ('pending', 'completed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недопустимый статус возврата');
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Укажите причину');
  END IF;

  v_calc_mode := COALESCE(NULLIF(trim(p_calc_mode), ''), 'pro_rata');
  IF v_calc_mode NOT IN ('pro_rata', 'single_visit_rate') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недопустимый режим расчёта');
  END IF;

  IF v_calc_mode = 'single_visit_rate' THEN
    IF p_single_visit_rate IS NULL OR p_single_visit_rate < 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Укажите тариф разового посещения');
    END IF;
  END IF;

  BEGIN
    v_sub_uuid := p_sub_id::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RETURN jsonb_build_object('success', false, 'error', 'Абонемент не найден');
  END;

  SELECT * INTO v_sub
  FROM subscriptions
  WHERE id = v_sub_uuid
    AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Абонемент не найден');
  END IF;

  IF v_sub.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Абонемент уже завершён');
  END IF;

  IF NOT subscription_refund_validate_recipient(v_org_id, v_sub, p_recipient_client_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Получатель должен быть участником абонемента');
  END IF;

  v_available := subscription_refund_available_amount(v_org_id, v_sub_uuid);
  v_operation_date := COALESCE(p_operation_date, _org_local_date(v_org_id));

  IF _is_finance_period_closed(v_org_id, v_operation_date) THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.error.periodClosed');
  END IF;

  v_lessons_used := GREATEST(0, v_sub.lessons_total - v_sub.lessons_left);

  IF v_calc_mode = 'single_visit_rate' THEN
    v_recommended := subscription_refund_recommended_by_single_visit_rate(v_sub, p_single_visit_rate);
    v_retained := payroll_round_money(v_lessons_used * p_single_visit_rate);
    v_formula := subscription_refund_formula_snapshot(
      v_sub,
      'single_visit_rate',
      p_single_visit_rate,
      p_single_visit_tariff_id
    );
  ELSE
    v_recommended := subscription_recommended_refund_amount(v_sub);
    v_retained := NULL;
    v_formula := subscription_refund_formula_snapshot(v_sub, 'pro_rata', NULL, NULL);
  END IF;

  IF p_amount IS NULL OR p_amount < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Сумма возврата должна быть неотрицательной');
  END IF;

  v_rounded_amount := payroll_round_money(p_amount);

  IF v_rounded_amount = 0 AND p_status = 'completed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Для завершения без возврата используйте обычное завершение');
  END IF;

  IF v_rounded_amount > v_available THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Сумма превышает доступный остаток (%s)', v_available)
    );
  END IF;

  v_amount_override := COALESCE(p_amount_override, false);
  IF v_recommended IS NOT NULL
    AND abs(v_rounded_amount - payroll_round_money(v_recommended)) > 0.009
  THEN
    v_amount_override := true;
  END IF;

  IF v_amount_override THEN
    v_formula := v_formula || jsonb_build_object('amountOverride', true);
  END IF;

  SELECT * INTO v_payment
  FROM payments p
  WHERE p.organization_id = v_org_id
    AND p.subscription_id = v_sub_uuid
    AND p.personal_lesson_id IS NULL
  ORDER BY p.created_at
  LIMIT 1;

  PERFORM set_config('app.allow_subscription_counter_update', 'true', true);

  UPDATE subscriptions
  SET status = 'finished',
      finished_at = now(),
      finish_reason = trim(p_reason),
      finished_by_member_id = v_member_id
  WHERE id = v_sub_uuid
    AND organization_id = v_org_id;

  IF v_rounded_amount > 0 THEN
    INSERT INTO subscription_refunds (
      organization_id,
      subscription_id,
      client_id,
      payment_id,
      amount,
      recommended_amount,
      method,
      status,
      reason,
      formula_snapshot,
      operation_date,
      idempotency_key,
      completed_at,
      created_by_member_id,
      refund_kind,
      lessons_deducted,
      calc_mode,
      single_visit_tariff_id,
      single_visit_rate,
      retained_amount,
      amount_override
    ) VALUES (
      v_org_id,
      v_sub_uuid,
      p_recipient_client_id,
      v_payment.id,
      v_rounded_amount,
      v_recommended,
      p_method,
      p_status,
      trim(p_reason),
      v_formula,
      v_operation_date,
      p_idempotency_key,
      CASE WHEN p_status = 'completed' THEN now() ELSE NULL END,
      v_member_id,
      'finish',
      0,
      v_calc_mode,
      p_single_visit_tariff_id,
      CASE WHEN v_calc_mode = 'single_visit_rate' THEN p_single_visit_rate ELSE NULL END,
      v_retained,
      v_amount_override
    )
    RETURNING id INTO v_refund_id;

    IF p_status = 'completed' THEN
      PERFORM apply_subscription_refund_payroll_adjustment(
        v_org_id,
        v_refund_id,
        v_sub_uuid,
        v_rounded_amount,
        v_operation_date,
        v_payment.created_at
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'refundId', v_refund_id,
    'amount', v_rounded_amount,
    'status', p_status,
    'recommendedAmount', v_recommended,
    'availableBefore', v_available,
    'calcMode', v_calc_mode,
    'retainedAmount', v_retained,
    'amountOverride', v_amount_override
  );
END;
$$;

-- =============================================================================
-- update_payment_in_place — operation date of the original payment
-- =============================================================================

CREATE OR REPLACE FUNCTION update_payment_in_place(
  p_payment_id uuid,
  p_new_amount numeric,
  p_new_method text,
  p_reason_code text,
  p_reason_comment text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_payment payments%ROWTYPE;
  v_old_amount numeric;
  v_old_method text;
  v_op_num bigint;
  v_fingerprint text;
  v_cached jsonb;
  v_result jsonb;
  v_charge_id uuid;
  v_old_billed numeric;
  v_old_net numeric;
  v_new_billed numeric;
  v_restated boolean := false;
  v_operation_date date;
BEGIN
  v_fingerprint := md5(
    coalesce(p_payment_id::text, '') || '|inplace|' ||
    coalesce(p_new_amount::text, '') || '|' ||
    coalesce(p_new_method, '') || '|' ||
    coalesce(p_reason_code, '')
  );

  v_cached := check_operation_idempotency(v_org_id, 'update_payment_in_place', p_idempotency_key, v_fingerprint);
  IF v_cached IS NOT NULL THEN
    IF (v_cached ->> 'success')::boolean IS NOT TRUE AND v_cached ->> 'error_code' = 'idempotency_conflict' THEN
      RETURN v_cached;
    END IF;
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  IF NOT member_can_correct_payments() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав');
  END IF;

  IF p_reason_code IS NULL OR trim(p_reason_code) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Укажите причину');
  END IF;

  IF p_new_method NOT IN ('cash', 'transfer', 'card', 'other') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недопустимый способ оплаты');
  END IF;

  IF p_new_amount IS NULL OR p_new_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Сумма должна быть положительной');
  END IF;

  SELECT * INTO v_payment
  FROM payments
  WHERE id = p_payment_id AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND OR v_payment.operation_kind <> 'payment' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Платёж не найден');
  END IF;

  v_operation_date := _payment_operation_date(v_org_id, v_payment);
  IF _is_finance_period_closed(v_org_id, v_operation_date) THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.error.periodClosed');
  END IF;

  IF payment_correction_status(v_org_id, p_payment_id) IN ('voided', 'replaced') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Платёж уже исправлен или аннулирован');
  END IF;

  v_old_amount := v_payment.amount;
  v_old_method := v_payment.method;

  v_charge_id := v_payment.personal_lesson_charge_id;
  IF v_charge_id IS NULL AND v_payment.personal_lesson_id IS NOT NULL THEN
    SELECT id INTO v_charge_id
    FROM personal_lesson_charges
    WHERE organization_id = v_org_id
      AND personal_lesson_id = v_payment.personal_lesson_id
      AND client_id = v_payment.client_id
    LIMIT 1;
  END IF;

  IF v_old_amount = p_new_amount AND v_old_method = p_new_method
     AND NOT (v_charge_id IS NOT NULL AND p_reason_code = 'wrong_amount') THEN
    RETURN jsonb_build_object('success', false, 'error', 'corrections.payment.nothingChanged');
  END IF;

  IF v_charge_id IS NOT NULL THEN
    SELECT billed_amount INTO v_old_billed
    FROM personal_lesson_charges
    WHERE organization_id = v_org_id AND id = v_charge_id
    FOR UPDATE;
    v_old_net := personal_lesson_charge_net_payment(v_org_id, v_charge_id);
  END IF;

  v_op_num := next_payment_operation_number(v_org_id);

  UPDATE payments
  SET
    amount = p_new_amount,
    method = p_new_method,
    correction_reason_code = p_reason_code,
    correction_comment = p_reason_comment,
    operation_number = v_op_num
  WHERE id = p_payment_id AND organization_id = v_org_id;

  IF v_charge_id IS NOT NULL
     AND v_old_billed IS NOT NULL
     AND (p_new_amount <> v_old_amount OR p_reason_code = 'wrong_amount') THEN
    v_new_billed := GREATEST(personal_lesson_charge_net_payment(v_org_id, v_charge_id), 0);
    UPDATE personal_lesson_charges
    SET billed_amount = v_new_billed
    WHERE organization_id = v_org_id AND id = v_charge_id;
    v_restated := v_new_billed <> v_old_billed;
  END IF;

  IF v_payment.personal_lesson_id IS NOT NULL THEN
    PERFORM sync_personal_lesson_paid_status(v_org_id, v_payment.personal_lesson_id);
    IF v_restated THEN
      UPDATE personal_lessons
      SET price_id = NULL
      WHERE id = v_payment.personal_lesson_id
        AND organization_id = v_org_id;
    END IF;
  END IF;

  INSERT INTO audit_log (
    organization_id,
    table_name,
    operation,
    row_id,
    old_data,
    new_data,
    changed_by
  )
  VALUES (
    v_org_id,
    'payments',
    'UPDATE',
    p_payment_id,
    jsonb_build_object('amount', v_old_amount, 'method', v_old_method),
    jsonb_build_object(
      'correction_kind', 'UPDATE_IN_PLACE',
      'amount', p_new_amount,
      'method', p_new_method,
      'reason_code', p_reason_code,
      'reason_comment', p_reason_comment,
      'operation_number', v_op_num,
      'billed_restated', v_restated
    ),
    auth.uid()
  );

  v_result := jsonb_build_object(
    'success', true,
    'payment_id', p_payment_id,
    'operation_number', v_op_num,
    'billed_restated', v_restated
  );

  PERFORM store_operation_idempotency(v_org_id, 'update_payment_in_place', p_idempotency_key, v_fingerprint, v_result);
  RETURN v_result;
END;
$$;

-- =============================================================================
-- restate_personal_lesson_charge / write_off_personal_lesson_debt — lesson date
-- =============================================================================

CREATE OR REPLACE FUNCTION restate_personal_lesson_charge(
  p_lesson_id uuid,
  p_new_amount numeric,
  p_charge_id uuid DEFAULT NULL,
  p_reason_code text DEFAULT 'wrong_amount',
  p_reason_comment text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_charge_id uuid;
  v_charge_count integer;
  v_lesson_id uuid;
  v_lesson_date date;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.orgReadOnly');
  END IF;

  IF NOT can_read_financial() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF p_lesson_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.debtors.adjustInvalid');
  END IF;

  SELECT pl.date INTO v_lesson_date
  FROM personal_lessons pl
  WHERE pl.id = p_lesson_id AND pl.organization_id = v_org_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.debtors.adjustFailed');
  END IF;

  IF _is_finance_period_closed(v_org_id, v_lesson_date) THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.error.periodClosed');
  END IF;

  IF p_charge_id IS NOT NULL THEN
    SELECT id, personal_lesson_id INTO v_charge_id, v_lesson_id
    FROM personal_lesson_charges
    WHERE organization_id = v_org_id AND id = p_charge_id;

    IF NOT FOUND OR v_lesson_id IS DISTINCT FROM p_lesson_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'finance.debtors.adjustFailed');
    END IF;
  ELSE
    SELECT COUNT(*)::integer INTO v_charge_count
    FROM personal_lesson_charges
    WHERE organization_id = v_org_id
      AND personal_lesson_id = p_lesson_id;

    IF v_charge_count <> 1 THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'finance.debtors.adjustSplitNotSupported'
      );
    END IF;

    SELECT id INTO v_charge_id
    FROM personal_lesson_charges
    WHERE organization_id = v_org_id
      AND personal_lesson_id = p_lesson_id
    LIMIT 1;
  END IF;

  RETURN _restate_personal_lesson_charge_billed(
    v_org_id,
    v_charge_id,
    p_new_amount,
    COALESCE(NULLIF(trim(p_reason_code), ''), 'wrong_amount'),
    p_reason_comment,
    'RESTATE_BILLED'
  );
END;
$$;

-- write_off: keep (p_lesson_id, p_charge_id) signature — production order; add period guard.
DROP FUNCTION IF EXISTS write_off_personal_lesson_debt(uuid, uuid, text, text);

CREATE OR REPLACE FUNCTION write_off_personal_lesson_debt(
  p_lesson_id uuid,
  p_charge_id uuid DEFAULT NULL,
  p_reason_code text DEFAULT 'wrong_amount',
  p_reason_comment text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_lesson personal_lessons%ROWTYPE;
  v_charge personal_lesson_charges%ROWTYPE;
  v_charge_count integer;
  v_paid numeric;
  v_new_billed numeric;
  v_written_off numeric;
  v_reason text := COALESCE(NULLIF(trim(p_reason_code), ''), 'wrong_amount');
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.orgReadOnly');
  END IF;

  IF NOT can_read_financial() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF p_lesson_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.debtors.adjustInvalid');
  END IF;

  SELECT * INTO v_lesson
  FROM personal_lessons
  WHERE id = p_lesson_id AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.debtors.adjustFailed');
  END IF;

  IF _is_finance_period_closed(v_org_id, v_lesson.date) THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.error.periodClosed');
  END IF;

  IF p_charge_id IS NOT NULL THEN
    SELECT * INTO v_charge
    FROM personal_lesson_charges
    WHERE organization_id = v_org_id
      AND id = p_charge_id
      AND personal_lesson_id = p_lesson_id
    FOR UPDATE;
  ELSE
    SELECT COUNT(*)::integer INTO v_charge_count
    FROM personal_lesson_charges
    WHERE organization_id = v_org_id
      AND personal_lesson_id = p_lesson_id;

    IF v_charge_count <> 1 THEN
      RETURN jsonb_build_object('success', false, 'error', 'finance.debtors.writeOffGroupHint');
    END IF;

    SELECT * INTO v_charge
    FROM personal_lesson_charges
    WHERE organization_id = v_org_id
      AND personal_lesson_id = p_lesson_id
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.debtors.adjustFailed');
  END IF;

  SELECT COALESCE(SUM(payment_effective_amount(p)), 0) INTO v_paid
  FROM payments p
  WHERE p.organization_id = v_org_id
    AND (
      p.personal_lesson_charge_id = v_charge.id
      OR (
        p.personal_lesson_charge_id IS NULL
        AND p.personal_lesson_id = p_lesson_id
        AND p.client_id = v_charge.client_id
      )
    );

  v_paid := GREATEST(COALESCE(v_paid, 0), 0);
  v_new_billed := v_paid;
  v_written_off := ROUND(v_charge.billed_amount - v_new_billed, 2);

  IF v_written_off <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.debtors.writeOffEmpty');
  END IF;

  UPDATE personal_lesson_charges
  SET billed_amount = v_new_billed
  WHERE organization_id = v_org_id
    AND id = v_charge.id;

  UPDATE personal_lessons
  SET price_id = NULL
  WHERE id = p_lesson_id
    AND organization_id = v_org_id;

  PERFORM sync_personal_lesson_paid_status(v_org_id, p_lesson_id);

  INSERT INTO audit_log (
    organization_id,
    table_name,
    operation,
    row_id,
    old_data,
    new_data,
    changed_by
  )
  VALUES (
    v_org_id,
    'personal_lesson_charges',
    'UPDATE',
    v_charge.id,
    jsonb_build_object('billed_amount', v_charge.billed_amount),
    jsonb_build_object(
      'billed_amount', v_new_billed,
      'written_off', v_written_off,
      'reason_code', v_reason,
      'reason_comment', p_reason_comment,
      'correction_kind', 'write_off'
    ),
    auth.uid()
  );

  RETURN jsonb_build_object(
    'success', true,
    'written_off', v_written_off,
    'new_billed', v_new_billed,
    'paid_amount', v_paid
  );
END;
$$;

REVOKE ALL ON FUNCTION write_off_personal_lesson_debt(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION write_off_personal_lesson_debt(uuid, uuid, text, text) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
