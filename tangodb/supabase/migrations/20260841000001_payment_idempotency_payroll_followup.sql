-- Prompt 10 follow-up: idempotency on all payment RPCs, payroll net effect, mark_attendance audit

BEGIN;

-- =============================================================================
-- 1. Unified personal lesson payment (all roles) + idempotency
-- =============================================================================

CREATE OR REPLACE FUNCTION record_personal_lesson_payment(
  p_lesson_id uuid,
  p_amount numeric,
  p_method text DEFAULT 'cash',
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_role text := current_member_role();
  v_lesson personal_lessons%ROWTYPE;
  v_client_display text;
  v_fingerprint text;
  v_cached jsonb;
  v_payment_id uuid;
  v_op_num bigint;
  v_result jsonb;
BEGIN
  v_fingerprint := md5(
    coalesce(p_lesson_id::text, '') || '|' ||
    coalesce(p_amount::text, '') || '|' ||
    coalesce(p_method, '')
  );

  v_cached := check_operation_idempotency(
    v_org_id, 'record_personal_lesson_payment', p_idempotency_key, v_fingerprint
  );
  IF v_cached IS NOT NULL THEN
    IF (v_cached ->> 'success')::boolean IS NOT TRUE AND v_cached ->> 'error_code' = 'idempotency_conflict' THEN
      RETURN v_cached;
    END IF;
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Организация в режиме только чтения');
  END IF;

  IF NOT member_can_accept_payments() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Нет прав на запись платежа');
  END IF;

  IF p_method NOT IN ('cash', 'transfer', 'card', 'other') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недопустимый способ оплаты');
  END IF;

  IF p_amount IS NULL OR p_amount < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Сумма должна быть неотрицательной');
  END IF;

  SELECT * INTO v_lesson
  FROM personal_lessons
  WHERE id = p_lesson_id AND organization_id = v_org_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Урок не найден');
  END IF;

  IF v_role = 'teacher' AND v_lesson.teacher_member_id IS DISTINCT FROM v_member_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Нет доступа к этому уроку');
  END IF;

  IF v_lesson.client_id1 IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'У урока не указан клиент');
  END IF;

  SELECT trim(coalesce(c.last_name, '') || ' ' || coalesce(c.first_name, ''))
  INTO v_client_display
  FROM clients c
  WHERE c.organization_id = v_org_id AND c.id = v_lesson.client_id1;

  SELECT p.id INTO v_payment_id
  FROM payments p
  WHERE p.organization_id = v_org_id
    AND p.personal_lesson_id = p_lesson_id
    AND p.operation_kind = 'payment'
    AND p.replaces_payment_id IS NULL
    AND payment_remaining_amount(v_org_id, p.id) > 0
  ORDER BY p.created_at
  LIMIT 1;

  IF v_payment_id IS NOT NULL THEN
    v_result := jsonb_build_object(
      'success', true,
      'payment_id', v_payment_id,
      'already_applied', true
    );
    PERFORM store_operation_idempotency(
      v_org_id, 'record_personal_lesson_payment', p_idempotency_key, v_fingerprint, v_result
    );
    PERFORM sync_personal_lesson_paid_status(v_org_id, p_lesson_id);
    RETURN v_result;
  END IF;

  v_op_num := next_payment_operation_number(v_org_id);

  INSERT INTO payments (
    organization_id, client_id, client_display, amount, method,
    personal_lesson_id, created_by, operation_number,
    idempotency_key, idempotency_scope, payload_fingerprint
  )
  VALUES (
    v_org_id, v_lesson.client_id1, coalesce(nullif(v_client_display, ''), 'Клиент'),
    p_amount, p_method, v_lesson.id, v_member_id, v_op_num,
    p_idempotency_key, 'record_personal_lesson_payment', v_fingerprint
  )
  RETURNING id INTO v_payment_id;

  PERFORM sync_personal_lesson_paid_status(v_org_id, p_lesson_id);

  v_result := jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'operation_number', v_op_num
  );

  PERFORM store_operation_idempotency(
    v_org_id, 'record_personal_lesson_payment', p_idempotency_key, v_fingerprint, v_result
  );

  RETURN v_result;
EXCEPTION
  WHEN unique_violation THEN
    SELECT p.id INTO v_payment_id
    FROM payments p
    WHERE p.organization_id = v_org_id
      AND p.idempotency_scope = 'record_personal_lesson_payment'
      AND p.idempotency_key = p_idempotency_key;

    IF v_payment_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'payment_id', v_payment_id,
        'already_applied', true
      );
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'duplicate_payment');
END;
$$;

-- =============================================================================
-- 2. Single visit payment + idempotency
-- =============================================================================

CREATE OR REPLACE FUNCTION record_single_visit(
  p_visit_date date,
  p_schedule_slot_id uuid,
  p_client_id uuid,
  p_price_id uuid,
  p_method text DEFAULT 'cash',
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_slot schedule_slots%ROWTYPE;
  v_price prices%ROWTYPE;
  v_client_display text;
  v_visit_id uuid;
  v_payment_id uuid;
  v_fingerprint text;
  v_cached jsonb;
  v_op_num bigint;
  v_result jsonb;
BEGIN
  v_fingerprint := md5(
    coalesce(p_visit_date::text, '') || '|' ||
    coalesce(p_schedule_slot_id::text, '') || '|' ||
    coalesce(p_client_id::text, '') || '|' ||
    coalesce(p_price_id::text, '') || '|' ||
    coalesce(p_method, '')
  );

  v_cached := check_operation_idempotency(
    v_org_id, 'record_single_visit', p_idempotency_key, v_fingerprint
  );
  IF v_cached IS NOT NULL THEN
    IF (v_cached ->> 'success')::boolean IS NOT TRUE AND v_cached ->> 'error_code' = 'idempotency_conflict' THEN
      RETURN v_cached;
    END IF;
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Организация в режиме только чтения');
  END IF;

  IF p_visit_date IS NULL OR p_visit_date > current_date THEN
    RETURN jsonb_build_object('success', false, 'error', 'Разовое посещение можно отметить только за прошедший или текущий день');
  END IF;

  IF p_method NOT IN ('cash', 'transfer', 'card', 'other') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недопустимый способ оплаты');
  END IF;

  SELECT * INTO v_slot
  FROM schedule_slots ss
  WHERE ss.organization_id = v_org_id
    AND ss.id = p_schedule_slot_id
    AND ss.class_id IS NOT NULL
    AND ss.valid_from <= p_visit_date
    AND (ss.valid_to IS NULL OR ss.valid_to >= p_visit_date)
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Групповое занятие не найдено');
  END IF;

  IF NOT can_record_single_visit_for_slot(v_slot) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав для разового посещения');
  END IF;

  SELECT * INTO v_price
  FROM prices pr
  WHERE pr.organization_id = v_org_id
    AND pr.id = p_price_id
    AND pr.category = 'single_visit';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Тариф разового посещения не найден');
  END IF;

  IF v_price.location_id IS NOT NULL AND v_price.location_id IS DISTINCT FROM v_slot.location_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Тариф не подходит для этой локации');
  END IF;

  IF v_price.discipline_id IS NOT NULL AND v_price.discipline_id IS DISTINCT FROM v_slot.discipline_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Тариф не подходит для этого направления');
  END IF;

  SELECT trim(coalesce(c.last_name, '') || ' ' || coalesce(c.first_name, ''))
  INTO v_client_display
  FROM clients c
  WHERE c.organization_id = v_org_id AND c.id = p_client_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Клиент не найден');
  END IF;

  INSERT INTO single_visits (
    organization_id, visit_date, schedule_slot_id, schedule_group_id,
    client_id, client_display, price_id, amount, method,
    location_id, discipline_id, teacher_member_id, created_by
  )
  VALUES (
    v_org_id, p_visit_date, v_slot.id, v_slot.class_id,
    p_client_id, coalesce(nullif(v_client_display, ''), 'Клиент'),
    v_price.id, v_price.price, p_method,
    v_slot.location_id, v_slot.discipline_id, v_slot.teacher_member_id, v_member_id
  )
  ON CONFLICT (organization_id, visit_date, schedule_slot_id, client_id)
  DO UPDATE SET
    price_id = EXCLUDED.price_id,
    amount = EXCLUDED.amount,
    method = EXCLUDED.method,
    client_display = EXCLUDED.client_display,
    teacher_member_id = EXCLUDED.teacher_member_id,
    created_by = EXCLUDED.created_by,
    created_at = now()
  RETURNING id INTO v_visit_id;

  SELECT p.id INTO v_payment_id
  FROM payments p
  WHERE p.organization_id = v_org_id
    AND p.single_visit_id = v_visit_id
    AND p.operation_kind = 'payment'
    AND p.replaces_payment_id IS NULL
    AND payment_remaining_amount(v_org_id, p.id) > 0
  LIMIT 1;

  IF v_payment_id IS NULL THEN
    v_op_num := next_payment_operation_number(v_org_id);

    INSERT INTO payments (
      organization_id, client_id, client_display, amount, method,
      single_visit_id, created_by, operation_number,
      idempotency_key, idempotency_scope, payload_fingerprint
    )
    VALUES (
      v_org_id, p_client_id, coalesce(nullif(v_client_display, ''), 'Клиент'),
      v_price.price, p_method, v_visit_id, v_member_id, v_op_num,
      p_idempotency_key, 'record_single_visit', v_fingerprint
    )
    RETURNING id INTO v_payment_id;
  ELSE
    SELECT p.operation_number INTO v_op_num
    FROM payments p WHERE p.id = v_payment_id;
  END IF;

  v_result := jsonb_build_object(
    'success', true,
    'visitId', v_visit_id,
    'payment_id', v_payment_id,
    'operation_number', v_op_num
  );

  PERFORM store_operation_idempotency(
    v_org_id, 'record_single_visit', p_idempotency_key, v_fingerprint, v_result
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION record_single_visit(date, uuid, uuid, uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_single_visit(date, uuid, uuid, uuid, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION record_personal_lesson_payment(uuid, numeric, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_personal_lesson_payment(uuid, numeric, text, uuid) TO authenticated;

-- =============================================================================
-- 3. Payroll settlement — net payment effect (skip storno rows, use net base)
-- =============================================================================

CREATE OR REPLACE FUNCTION payroll_refresh_settlement_lines(
  p_org_id uuid,
  p_settlement_id uuid,
  p_member_id uuid,
  p_year int,
  p_month int,
  p_computed_at timestamptz
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date_from date;
  v_date_to date;
  v_accrued numeric := 0;
  v_payment record;
  v_rate record;
  v_category text;
  v_percent numeric;
  v_line_accrual numeric;
  v_fixed_pay_mode text;
  v_fixed_amount numeric;
  v_month_rate record;
  v_net_amount numeric;
BEGIN
  v_date_from := make_date(p_year, p_month, 1);
  v_date_to := (v_date_from + interval '1 month' - interval '1 day')::date;

  DELETE FROM teacher_settlement_line_items
  WHERE organization_id = p_org_id
    AND settlement_id = p_settlement_id;

  SELECT * INTO v_month_rate
  FROM payroll_rate_row_at_date(p_org_id, p_member_id, v_date_from);

  IF FOUND AND COALESCE(v_month_rate.pay_mode, 'percent') = 'fixed' THEN
    v_fixed_amount := COALESCE(v_month_rate.fixed_amount, 0);
    IF v_fixed_amount > 0 THEN
      v_accrued := v_accrued + v_fixed_amount;

      INSERT INTO teacher_settlement_line_items (
        organization_id, settlement_id, member_id, line_category, source_type,
        line_date, title, monetary_base, pay_mode, fixed_rate_amount,
        percent_rate, accrual_amount, included_in_total, sort_at, computed_at
      ) VALUES (
        p_org_id, p_settlement_id, p_member_id, 'fixed', 'rate',
        v_date_from, NULL, 0, v_month_rate.pay_mode, v_fixed_amount,
        0, v_fixed_amount, true, v_date_from::timestamptz, p_computed_at
      );
    END IF;
  END IF;

  FOR v_payment IN
    SELECT
      p.id,
      p.amount,
      p.created_at,
      p.client_display,
      p.subscription_id,
      p.personal_lesson_id,
      p.single_visit_id,
      payroll_payment_net_amount(p_org_id, p.id) AS net_amount,
      payroll_payment_category(
        p.personal_lesson_id,
        p.subscription_id,
        p.single_visit_id
      ) AS category,
      pl.date AS personal_date,
      pl.time_start AS personal_time_start,
      pl.time_end AS personal_time_end,
      pl.client_display AS personal_client_display,
      pl_d.name AS personal_discipline_name,
      pl_l.name AS personal_location_name,
      sv.visit_date AS single_visit_date,
      sv.client_display AS single_visit_client_display,
      COALESCE(sv_d.name, ss_d.name) AS single_discipline_name,
      COALESCE(sv_l.name, ss_l.name) AS single_location_name,
      ss.time_start AS single_time_start,
      ss.time_end AS single_time_end,
      grp.group_name,
      grp.discipline_name AS group_discipline_name,
      grp.location_name AS group_location_name
    FROM payments p
    LEFT JOIN personal_lessons pl
      ON pl.organization_id = p.organization_id AND pl.id = p.personal_lesson_id
    LEFT JOIN disciplines pl_d ON pl_d.id = pl.discipline_id
    LEFT JOIN locations pl_l ON pl_l.id = pl.location_id
    LEFT JOIN single_visits sv
      ON sv.organization_id = p.organization_id AND sv.id = p.single_visit_id
    LEFT JOIN schedule_slots ss
      ON ss.organization_id = sv.organization_id AND ss.id = sv.schedule_slot_id
    LEFT JOIN disciplines sv_d ON sv_d.id = sv.discipline_id
    LEFT JOIN locations sv_l ON sv_l.id = sv.location_id
    LEFT JOIN disciplines ss_d ON ss_d.id = ss.discipline_id
    LEFT JOIN locations ss_l ON ss_l.id = ss.location_id
    LEFT JOIN LATERAL (
      SELECT c.name AS group_name, d.name AS discipline_name, l.name AS location_name
      FROM subscription_groups sg
      JOIN classes c ON c.organization_id = sg.organization_id AND c.id = sg.schedule_group_id
      LEFT JOIN disciplines d ON d.id = c.discipline_id
      LEFT JOIN locations l ON l.id = c.default_location_id
      WHERE sg.organization_id = p.organization_id AND sg.subscription_id = p.subscription_id
      ORDER BY sg.id
      LIMIT 1
    ) grp ON p.subscription_id IS NOT NULL
    WHERE p.organization_id = p_org_id
      AND COALESCE(p.operation_kind, 'payment') = 'payment'
      AND p.replaces_payment_id IS NULL
      AND p.created_at >= v_date_from
      AND p.created_at < (v_date_to + interval '1 day')
      AND payroll_resolve_payment_teacher_id(
        p_org_id, p.personal_lesson_id, p.subscription_id, p.single_visit_id
      ) = p_member_id
    ORDER BY p.created_at, p.id
  LOOP
    v_net_amount := COALESCE(v_payment.net_amount, 0);
    IF v_net_amount = 0 THEN
      CONTINUE;
    END IF;

    v_category := v_payment.category;
    IF v_category IS NULL THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_rate
    FROM payroll_rate_row_at_date(
      p_org_id,
      p_member_id,
      (v_payment.created_at AT TIME ZONE 'UTC')::date
    );

    IF NOT FOUND OR COALESCE(v_rate.pay_mode, 'percent') = 'fixed' THEN
      v_line_accrual := 0;
      v_percent := 0;
    ELSE
      v_percent := CASE v_category
        WHEN 'personal' THEN COALESCE(v_rate.personal_rate_percent, 0)
        WHEN 'single_visit' THEN COALESCE(v_rate.single_visit_rate_percent, 0)
        ELSE COALESCE(v_rate.group_rate_percent, 0)
      END;
      v_line_accrual := payroll_percent_accrual(v_net_amount, v_percent);
    END IF;

    IF v_line_accrual = 0 THEN
      CONTINUE;
    END IF;

    v_accrued := v_accrued + v_line_accrual;

    INSERT INTO teacher_settlement_line_items (
      organization_id, settlement_id, member_id, line_category, source_type,
      source_id, line_date, time_start, time_end, title, discipline_name,
      location_name, monetary_base, pay_mode, fixed_rate_amount, percent_rate,
      accrual_amount, included_in_total, sort_at, computed_at
    ) VALUES (
      p_org_id,
      p_settlement_id,
      p_member_id,
      CASE WHEN v_net_amount < 0 THEN 'adjustment' ELSE v_category END,
      'payment',
      v_payment.id,
      COALESCE(
        v_payment.personal_date,
        v_payment.single_visit_date,
        (v_payment.created_at AT TIME ZONE 'UTC')::date
      ),
      COALESCE(v_payment.personal_time_start, v_payment.single_time_start),
      COALESCE(v_payment.personal_time_end, v_payment.single_time_end),
      COALESCE(
        v_payment.group_name,
        v_payment.personal_client_display,
        v_payment.single_visit_client_display,
        v_payment.client_display
      ),
      COALESCE(
        v_payment.group_discipline_name,
        v_payment.personal_discipline_name,
        v_payment.single_discipline_name
      ),
      COALESCE(
        v_payment.group_location_name,
        v_payment.personal_location_name,
        v_payment.single_location_name
      ),
      payroll_round_money(v_net_amount),
      COALESCE(v_rate.pay_mode, 'percent'),
      0,
      v_percent,
      v_line_accrual,
      true,
      v_payment.created_at,
      p_computed_at
    );
  END LOOP;

  RETURN payroll_round_money(v_accrued);
END;
$$;

COMMIT;
