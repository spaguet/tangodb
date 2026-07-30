-- Partial subscription refunds, pending completion/cancel (CRM scenario 9 follow-up)

BEGIN;

ALTER TABLE subscription_refunds
  ADD COLUMN IF NOT EXISTS refund_kind TEXT NOT NULL DEFAULT 'finish'
    CHECK (refund_kind IN ('partial', 'finish')),
  ADD COLUMN IF NOT EXISTS lessons_deducted INT NOT NULL DEFAULT 0
    CHECK (lessons_deducted >= 0),
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by_member_id UUID,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscription_refunds_cancelled_by_member_id_fkey'
  ) THEN
    ALTER TABLE subscription_refunds
      ADD CONSTRAINT subscription_refunds_cancelled_by_member_id_fkey
      FOREIGN KEY (organization_id, cancelled_by_member_id)
      REFERENCES organization_members (organization_id, id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION subscription_refund_pending_total(
  p_org_id uuid,
  p_sub_id uuid,
  p_exclude_refund_id uuid DEFAULT NULL
)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(SUM(sr.amount), 0)
  FROM subscription_refunds sr
  WHERE sr.organization_id = p_org_id
    AND sr.subscription_id = p_sub_id
    AND sr.status = 'pending'
    AND (p_exclude_refund_id IS NULL OR sr.id <> p_exclude_refund_id);
$$;

CREATE OR REPLACE FUNCTION subscription_refund_available_amount(p_org_id uuid, p_sub_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT GREATEST(
    0,
    subscription_sale_price(p_org_id, p_sub_id)
      - subscription_refunded_total(p_org_id, p_sub_id, NULL)
      - subscription_refund_pending_total(p_org_id, p_sub_id, NULL)
  );
$$;

CREATE OR REPLACE FUNCTION subscription_refund_formula_snapshot(p_sub subscriptions)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_sale_price numeric;
  v_received numeric;
  v_prior_refunds numeric;
  v_pending_refunds numeric;
  v_available numeric;
  v_recommended numeric;
  v_per_lesson numeric;
  v_lessons_used int;
BEGIN
  v_sale_price := subscription_sale_price(p_sub.organization_id, p_sub.id);

  SELECT COALESCE(SUM(p.amount), 0)
  INTO v_received
  FROM payments p
  WHERE p.organization_id = p_sub.organization_id
    AND p.subscription_id = p_sub.id
    AND p.personal_lesson_id IS NULL;

  v_prior_refunds := subscription_refunded_total(p_sub.organization_id, p_sub.id, NULL);
  v_pending_refunds := subscription_refund_pending_total(p_sub.organization_id, p_sub.id, NULL);
  v_available := subscription_refund_available_amount(p_sub.organization_id, p_sub.id);
  v_recommended := subscription_recommended_refund_amount(p_sub);
  v_lessons_used := GREATEST(0, p_sub.lessons_total - p_sub.lessons_left);

  IF p_sub.billing_model = 'monthly_unlimited' OR p_sub.lessons_total <= 0 THEN
    RETURN jsonb_build_object(
      'billingModel', p_sub.billing_model,
      'requiresManualAmount', true,
      'salePrice', v_sale_price,
      'receivedTotal', payroll_round_money(v_received),
      'priorRefunds', payroll_round_money(v_prior_refunds),
      'pendingRefunds', payroll_round_money(v_pending_refunds),
      'availableAmount', payroll_round_money(v_available),
      'expiresAt', p_sub.expires_at,
      'activationDate', p_sub.activation_date
    );
  END IF;

  v_per_lesson := payroll_round_money(v_sale_price / p_sub.lessons_total::numeric);

  RETURN jsonb_build_object(
    'billingModel', p_sub.billing_model,
    'requiresManualAmount', false,
    'salePrice', v_sale_price,
    'receivedTotal', payroll_round_money(v_received),
    'priorRefunds', payroll_round_money(v_prior_refunds),
    'pendingRefunds', payroll_round_money(v_pending_refunds),
    'availableAmount', payroll_round_money(v_available),
    'recommendedAmount', COALESCE(v_recommended, 0),
    'lessonsTotal', p_sub.lessons_total,
    'lessonsLeft', p_sub.lessons_left,
    'lessonsUsed', v_lessons_used,
    'perLessonPrice', v_per_lesson,
    'formula', format(
      '%s × %s / %s = %s',
      v_sale_price,
      p_sub.lessons_left,
      p_sub.lessons_total,
      COALESCE(v_recommended, 0)
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION subscription_refund_validate_recipient(
  p_org_id uuid,
  p_sub subscriptions,
  p_recipient_client_id uuid
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM clients c
    WHERE c.organization_id = p_org_id
      AND c.id = p_recipient_client_id
      AND c.id IN (p_sub.client_id1, p_sub.client_id2, p_sub.client_id3, p_sub.client_id4)
  );
$$;

CREATE OR REPLACE FUNCTION subscription_refund_resolve_lessons_deducted(
  p_sub subscriptions,
  p_amount numeric,
  p_per_lesson numeric,
  p_lessons_to_deduct int
)
RETURNS int
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_computed int;
BEGIN
  IF p_sub.billing_model = 'monthly_unlimited' OR p_sub.lessons_total <= 0 THEN
    RETURN 0;
  END IF;

  IF p_lessons_to_deduct IS NULL THEN
    RETURN 0;
  END IF;

  IF p_lessons_to_deduct < 0 OR p_lessons_to_deduct > p_sub.lessons_left THEN
    RAISE EXCEPTION 'invalid lessons_to_deduct';
  END IF;

  RETURN p_lessons_to_deduct;
END;
$$;

CREATE OR REPLACE FUNCTION create_subscription_refund(
  p_sub_id text,
  p_recipient_client_id uuid,
  p_amount numeric,
  p_method text DEFAULT 'cash',
  p_reason text DEFAULT NULL,
  p_status text DEFAULT 'completed',
  p_operation_date date DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL,
  p_lessons_to_deduct int DEFAULT NULL
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
  v_rounded_amount numeric;
  v_operation_date date;
  v_formula jsonb;
  v_refund_id uuid;
  v_lessons_deducted int;
  v_per_lesson numeric;
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
    RETURN jsonb_build_object('success', false, 'error', 'Частичный возврат доступен только для активного абонемента');
  END IF;

  IF NOT subscription_refund_validate_recipient(v_org_id, v_sub, p_recipient_client_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Получатель должен быть участником абонемента');
  END IF;

  v_available := subscription_refund_available_amount(v_org_id, v_sub_uuid);
  v_formula := subscription_refund_formula_snapshot(v_sub);
  v_operation_date := COALESCE(p_operation_date, current_date);

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Сумма возврата должна быть больше нуля');
  END IF;

  v_rounded_amount := payroll_round_money(p_amount);

  IF v_rounded_amount > v_available THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Сумма превышает доступный остаток (%s)', v_available)
    );
  END IF;

  BEGIN
    IF v_sub.lessons_total > 0 THEN
      v_per_lesson := payroll_round_money(
        subscription_sale_price(v_org_id, v_sub_uuid) / v_sub.lessons_total::numeric
      );
    ELSE
      v_per_lesson := 0;
    END IF;
    v_lessons_deducted := subscription_refund_resolve_lessons_deducted(
      v_sub,
      v_rounded_amount,
      v_per_lesson,
      p_lessons_to_deduct
    );
  EXCEPTION
    WHEN OTHERS THEN
      RETURN jsonb_build_object('success', false, 'error', 'Некорректное количество уроков для списания');
  END;

  SELECT * INTO v_payment
  FROM payments p
  WHERE p.organization_id = v_org_id
    AND p.subscription_id = v_sub_uuid
    AND p.personal_lesson_id IS NULL
  ORDER BY p.created_at
  LIMIT 1;

  IF v_lessons_deducted > 0 THEN
    PERFORM set_config('app.allow_subscription_counter_update', 'true', true);
    UPDATE subscriptions
    SET lessons_left = lessons_left - v_lessons_deducted
    WHERE id = v_sub_uuid
      AND organization_id = v_org_id;
  END IF;

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
    lessons_deducted
  ) VALUES (
    v_org_id,
    v_sub_uuid,
    p_recipient_client_id,
    v_payment.id,
    v_rounded_amount,
    subscription_recommended_refund_amount(v_sub),
    p_method,
    p_status,
    trim(p_reason),
    v_formula,
    v_operation_date,
    p_idempotency_key,
    CASE WHEN p_status = 'completed' THEN now() ELSE NULL END,
    v_member_id,
    'partial',
    v_lessons_deducted
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

  RETURN jsonb_build_object(
    'success', true,
    'refundId', v_refund_id,
    'amount', v_rounded_amount,
    'status', p_status,
    'lessonsDeducted', v_lessons_deducted,
    'availableBefore', v_available
  );
END;
$$;

CREATE OR REPLACE FUNCTION complete_subscription_refund(
  p_refund_id uuid,
  p_operation_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_refund subscription_refunds%ROWTYPE;
  v_payment payments%ROWTYPE;
  v_operation_date date;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  IF NOT member_can_issue_refunds() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав');
  END IF;

  SELECT * INTO v_refund
  FROM subscription_refunds sr
  WHERE sr.id = p_refund_id
    AND sr.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Возврат не найден');
  END IF;

  IF v_refund.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Возврат уже обработан');
  END IF;

  v_operation_date := COALESCE(p_operation_date, current_date);

  UPDATE subscription_refunds
  SET status = 'completed',
      completed_at = now(),
      operation_date = v_operation_date
  WHERE id = v_refund.id
    AND organization_id = v_org_id;

  SELECT * INTO v_payment
  FROM payments p
  WHERE p.organization_id = v_org_id
    AND p.id = v_refund.payment_id;

  PERFORM apply_subscription_refund_payroll_adjustment(
    v_org_id,
    v_refund.id,
    v_refund.subscription_id,
    v_refund.amount,
    v_operation_date,
    COALESCE(v_payment.created_at, v_operation_date::timestamptz)
  );

  RETURN jsonb_build_object(
    'success', true,
    'refundId', v_refund.id,
    'amount', v_refund.amount,
    'status', 'completed'
  );
END;
$$;

CREATE OR REPLACE FUNCTION cancel_subscription_refund(
  p_refund_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_refund subscription_refunds%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  IF NOT member_can_issue_refunds() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав');
  END IF;

  SELECT * INTO v_refund
  FROM subscription_refunds sr
  WHERE sr.id = p_refund_id
    AND sr.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Возврат не найден');
  END IF;

  IF v_refund.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Отменить можно только ожидающий возврат');
  END IF;

  IF v_refund.refund_kind = 'partial' AND v_refund.lessons_deducted > 0 THEN
    PERFORM set_config('app.allow_subscription_counter_update', 'true', true);
    UPDATE subscriptions
    SET lessons_left = lessons_left + v_refund.lessons_deducted
    WHERE id = v_refund.subscription_id
      AND organization_id = v_org_id
      AND status = 'active';
  END IF;

  UPDATE subscription_refunds
  SET status = 'cancelled',
      cancelled_at = now(),
      cancelled_by_member_id = v_member_id,
      cancel_reason = NULLIF(trim(p_reason), '')
  WHERE id = v_refund.id
    AND organization_id = v_org_id;

  RETURN jsonb_build_object('success', true, 'refundId', v_refund.id);
END;
$$;

-- Tag existing finish refunds
UPDATE subscription_refunds
SET refund_kind = 'finish'
WHERE refund_kind IS DISTINCT FROM 'partial';

-- finish_subscription_with_refund: set refund_kind = 'finish' on insert
CREATE OR REPLACE FUNCTION finish_subscription_with_refund(
  p_sub_id text,
  p_recipient_client_id uuid,
  p_amount numeric,
  p_method text DEFAULT 'cash',
  p_reason text DEFAULT NULL,
  p_status text DEFAULT 'completed',
  p_operation_date date DEFAULT NULL,
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
  v_recommended := subscription_recommended_refund_amount(v_sub);
  v_formula := subscription_refund_formula_snapshot(v_sub);
  v_operation_date := COALESCE(p_operation_date, current_date);

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
      lessons_deducted
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
      0
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
    'availableBefore', v_available
  );
END;
$$;

REVOKE ALL ON FUNCTION create_subscription_refund(
  text, uuid, numeric, text, text, text, date, uuid, int
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_subscription_refund(
  text, uuid, numeric, text, text, text, date, uuid, int
) TO authenticated;

REVOKE ALL ON FUNCTION complete_subscription_refund(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION complete_subscription_refund(uuid, date) TO authenticated;

REVOKE ALL ON FUNCTION cancel_subscription_refund(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_subscription_refund(uuid, text) TO authenticated;

COMMIT;
