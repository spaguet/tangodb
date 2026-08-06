-- Audit fixes: subscription refund calc audit trail, expense category filter parity, venue rule validation.

BEGIN;

-- =============================================================================
-- 1. subscription_refunds audit columns
-- =============================================================================

ALTER TABLE subscription_refunds
  ADD COLUMN IF NOT EXISTS calc_mode TEXT
    CHECK (calc_mode IS NULL OR calc_mode IN ('pro_rata', 'single_visit_rate')),
  ADD COLUMN IF NOT EXISTS single_visit_tariff_id UUID,
  ADD COLUMN IF NOT EXISTS single_visit_rate NUMERIC,
  ADD COLUMN IF NOT EXISTS retained_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS amount_override BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscription_refunds_single_visit_tariff_id_fkey'
  ) THEN
    ALTER TABLE subscription_refunds
      ADD CONSTRAINT subscription_refunds_single_visit_tariff_id_fkey
      FOREIGN KEY (single_visit_tariff_id) REFERENCES prices (id);
  END IF;
END;
$$;

-- =============================================================================
-- 2. Single-visit recommended refund (caps by available, nets prior/pending refunds)
-- =============================================================================

CREATE OR REPLACE FUNCTION subscription_refund_recommended_by_single_visit_rate(
  p_sub subscriptions,
  p_single_visit_rate numeric
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_sale_price numeric;
  v_available numeric;
  v_lessons_used int;
  v_retained numeric;
  v_raw numeric;
BEGIN
  IF p_sub.billing_model = 'monthly_unlimited' THEN
    RETURN NULL;
  END IF;

  IF p_sub.lessons_total IS NULL OR p_sub.lessons_total <= 0 THEN
    RETURN NULL;
  END IF;

  IF p_single_visit_rate IS NULL OR p_single_visit_rate < 0 THEN
    RETURN NULL;
  END IF;

  v_sale_price := subscription_sale_price(p_sub.organization_id, p_sub.id);
  v_available := subscription_refund_available_amount(p_sub.organization_id, p_sub.id);
  v_lessons_used := GREATEST(0, p_sub.lessons_total - p_sub.lessons_left);

  IF v_available <= 0 THEN
    RETURN 0;
  END IF;

  v_retained := payroll_round_money(v_lessons_used * p_single_visit_rate);
  v_raw := GREATEST(0, payroll_round_money(v_sale_price - v_retained));

  RETURN LEAST(v_raw, v_available);
END;
$$;

-- =============================================================================
-- 3. Formula snapshot with calc mode metadata
-- =============================================================================

CREATE OR REPLACE FUNCTION subscription_refund_formula_snapshot(
  p_sub subscriptions,
  p_calc_mode text DEFAULT 'pro_rata',
  p_single_visit_rate numeric DEFAULT NULL,
  p_single_visit_tariff_id uuid DEFAULT NULL
)
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
  v_retained numeric;
  v_calc_mode text;
BEGIN
  v_calc_mode := COALESCE(NULLIF(trim(p_calc_mode), ''), 'pro_rata');
  IF v_calc_mode NOT IN ('pro_rata', 'single_visit_rate') THEN
    v_calc_mode := 'pro_rata';
  END IF;

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
      'activationDate', p_sub.activation_date,
      'calcMode', v_calc_mode
    );
  END IF;

  v_per_lesson := payroll_round_money(v_sale_price / p_sub.lessons_total::numeric);

  IF v_calc_mode = 'single_visit_rate' AND p_single_visit_rate IS NOT NULL AND p_single_visit_rate >= 0 THEN
    v_retained := payroll_round_money(v_lessons_used * p_single_visit_rate);
    v_recommended := subscription_refund_recommended_by_single_visit_rate(p_sub, p_single_visit_rate);

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
      'calcMode', 'single_visit_rate',
      'singleVisitRate', p_single_visit_rate,
      'singleVisitTariffId', p_single_visit_tariff_id,
      'retainedAmount', v_retained,
      'formula', format(
        '%s − %s × %s = %s (cap %s)',
        v_sale_price,
        v_lessons_used,
        p_single_visit_rate,
        COALESCE(v_recommended, 0),
        payroll_round_money(v_available)
      )
    );
  END IF;

  v_recommended := subscription_recommended_refund_amount(p_sub);

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
    'calcMode', 'pro_rata',
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

-- =============================================================================
-- 4. Preview RPC with calc params
-- =============================================================================

CREATE OR REPLACE FUNCTION preview_subscription_refund(
  p_sub_id text,
  p_calc_mode text DEFAULT 'pro_rata',
  p_single_visit_rate numeric DEFAULT NULL,
  p_single_visit_tariff_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_sub subscriptions%ROWTYPE;
  v_sub_uuid uuid;
  v_participants jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL OR NOT member_can_read_refunds() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав');
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
    AND organization_id = v_org_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Абонемент не найден');
  END IF;

  IF v_sub.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Абонемент уже завершён');
  END IF;

  IF subscription_refund_available_amount(v_org_id, v_sub_uuid) <= 0
    AND v_sub.billing_model <> 'monthly_unlimited'
  THEN
    RETURN jsonb_build_object('success', false, 'error', 'Нет доступной суммы для возврата');
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'clientId', c.id,
      'displayName', trim(coalesce(c.last_name, '') || ' ' || coalesce(c.first_name, ''))
    )
    ORDER BY ord
  ), '[]'::jsonb)
  INTO v_participants
  FROM (
    SELECT 1 AS ord, v_sub.client_id1 AS cid
    UNION ALL SELECT 2, v_sub.client_id2 WHERE v_sub.client_id2 IS NOT NULL
    UNION ALL SELECT 3, v_sub.client_id3 WHERE v_sub.client_id3 IS NOT NULL
    UNION ALL SELECT 4, v_sub.client_id4 WHERE v_sub.client_id4 IS NOT NULL
  ) slots
  JOIN clients c
    ON c.organization_id = v_org_id
   AND c.id = slots.cid;

  RETURN jsonb_build_object(
    'success', true,
    'subscriptionId', v_sub.id,
    'status', v_sub.status,
    'billingModel', v_sub.billing_model,
    'activationDate', v_sub.activation_date,
    'expiresAt', v_sub.expires_at,
    'lessonsTotal', v_sub.lessons_total,
    'lessonsLeft', v_sub.lessons_left,
    'participants', v_participants,
    'formula', subscription_refund_formula_snapshot(
      v_sub,
      p_calc_mode,
      p_single_visit_rate,
      p_single_visit_tariff_id
    )
  );
END;
$$;

-- =============================================================================
-- 5. Finish with refund — calc audit + columns
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
  v_operation_date := COALESCE(p_operation_date, current_date);
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
-- 6. Venue cost rules: require expense_category for active modes
-- =============================================================================

CREATE OR REPLACE FUNCTION venue_cost_rules_are_valid(p_mode text, p_rules jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_rule jsonb;
  v_tier jsonb;
  v_min integer;
  v_max integer;
  v_expected_min integer;
  v_expense_category text;
BEGIN
  IF p_mode = 'disabled' THEN
    RETURN p_rules IS NOT NULL AND jsonb_typeof(p_rules) = 'object';
  END IF;

  IF p_rules IS NULL OR jsonb_typeof(p_rules) <> 'object' THEN
    RETURN false;
  END IF;

  v_expense_category := NULLIF(p_rules ->> 'expense_category', '');
  IF v_expense_category IS NULL
    OR v_expense_category NOT IN ('rent', 'utilities', 'marketing', 'other')
  THEN
    RETURN false;
  END IF;

  IF length(btrim(COALESCE(p_rules ->> 'payee', ''))) = 0 THEN
    RETURN false;
  END IF;

  IF p_mode = 'fixed_period' THEN
    IF p_rules ->> 'period' NOT IN ('week', 'month', 'custom') THEN
      RETURN false;
    END IF;

    IF jsonb_array_length(COALESCE(p_rules -> 'locations', '[]'::jsonb)) > 0 THEN
      FOR v_rule IN SELECT value FROM jsonb_array_elements(p_rules -> 'locations')
      LOOP
        IF NULLIF(v_rule ->> 'location_id', '') IS NULL
          OR (v_rule ->> 'amount') IS NULL
          OR (v_rule ->> 'amount')::numeric < 0
        THEN
          RETURN false;
        END IF;
      END LOOP;
      RETURN true;
    END IF;

    RETURN (p_rules ->> 'amount') IS NOT NULL
      AND (p_rules ->> 'amount')::numeric >= 0;
  END IF;

  IF p_mode <> 'per_lesson'
    OR jsonb_typeof(COALESCE(p_rules -> 'group', '[]'::jsonb)) <> 'array'
    OR jsonb_typeof(COALESCE(p_rules -> 'personal', '[]'::jsonb)) <> 'array'
  THEN
    RETURN false;
  END IF;

  FOR v_rule IN SELECT value FROM jsonb_array_elements(COALESCE(p_rules -> 'group', '[]'::jsonb))
  LOOP
    IF jsonb_typeof(v_rule) <> 'object'
      OR NULLIF(v_rule ->> 'teacher_member_id', '') IS NOT NULL
      OR jsonb_typeof(COALESCE(v_rule -> 'attendance_tiers', 'null'::jsonb)) <> 'array'
      OR jsonb_array_length(v_rule -> 'attendance_tiers') = 0
    THEN
      RETURN false;
    END IF;
    IF v_rule ->> 'discipline_id' IS NOT NULL THEN
      PERFORM (v_rule ->> 'discipline_id')::uuid;
    END IF;
    IF v_rule ->> 'location_id' IS NOT NULL THEN
      PERFORM (v_rule ->> 'location_id')::uuid;
    END IF;
    v_expected_min := 0;
    FOR v_tier IN
      SELECT value
      FROM jsonb_array_elements(v_rule -> 'attendance_tiers')
      ORDER BY (value ->> 'min_attendees')::integer
    LOOP
      v_min := (v_tier ->> 'min_attendees')::integer;
      v_max := NULLIF(v_tier ->> 'max_attendees', '')::integer;
      IF v_min IS NULL OR v_expected_min IS NULL OR v_min <> v_expected_min
        OR v_min < 0 OR (v_max IS NOT NULL AND v_max < v_min)
        OR (v_tier ->> 'amount') IS NULL OR (v_tier ->> 'amount')::numeric < 0
      THEN
        RETURN false;
      END IF;
      v_expected_min := CASE WHEN v_max IS NULL THEN NULL ELSE v_max + 1 END;
    END LOOP;
    IF v_expected_min IS NOT NULL THEN RETURN false; END IF;
  END LOOP;

  FOR v_rule IN SELECT value FROM jsonb_array_elements(COALESCE(p_rules -> 'personal', '[]'::jsonb))
  LOOP
    IF jsonb_typeof(v_rule) <> 'object'
      OR NULLIF(v_rule ->> 'teacher_member_id', '') IS NOT NULL
      OR (v_rule ->> 'amount') IS NULL OR (v_rule ->> 'amount')::numeric < 0
    THEN
      RETURN false;
    END IF;
    IF v_rule ->> 'discipline_id' IS NOT NULL THEN
      PERFORM (v_rule ->> 'discipline_id')::uuid;
    END IF;
    IF v_rule ->> 'location_id' IS NOT NULL THEN
      PERFORM (v_rule ->> 'location_id')::uuid;
    END IF;
  END LOOP;

  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION preview_subscription_refund(text, text, numeric, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION preview_subscription_refund(text, text, numeric, uuid) TO authenticated;

REVOKE ALL ON FUNCTION finish_subscription_with_refund(
  text, uuid, numeric, text, text, text, date, uuid, text, numeric, uuid, boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finish_subscription_with_refund(
  text, uuid, numeric, text, text, text, date, uuid, text, numeric, uuid, boolean
) TO authenticated;

COMMIT;
