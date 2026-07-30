-- Subscription early finish with refund (CRM scenario 9 / Prompt 9)

BEGIN;

-- =============================================================================
-- 1. Schema
-- =============================================================================

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finish_reason TEXT,
  ADD COLUMN IF NOT EXISTS finished_by_member_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_finished_by_member_id_fkey'
  ) THEN
    ALTER TABLE subscriptions
      ADD CONSTRAINT subscriptions_finished_by_member_id_fkey
      FOREIGN KEY (organization_id, finished_by_member_id)
      REFERENCES organization_members (organization_id, id);
  END IF;
END;
$$;

CREATE TABLE subscription_refunds (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  subscription_id         UUID NOT NULL,
  client_id               UUID NOT NULL,
  payment_id              UUID,
  amount                  NUMERIC NOT NULL CHECK (amount > 0),
  recommended_amount      NUMERIC CHECK (recommended_amount IS NULL OR recommended_amount >= 0),
  method                  TEXT NOT NULL DEFAULT 'cash'
    CHECK (method IN ('cash', 'transfer', 'card', 'other')),
  status                  TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('pending', 'completed', 'cancelled')),
  reason                  TEXT NOT NULL,
  formula_snapshot        JSONB NOT NULL DEFAULT '{}'::jsonb,
  operation_date          DATE NOT NULL,
  idempotency_key         UUID,
  completed_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_member_id    UUID,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, subscription_id)
    REFERENCES subscriptions (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, client_id)
    REFERENCES clients (organization_id, id),
  FOREIGN KEY (organization_id, payment_id)
    REFERENCES payments (organization_id, id) ON DELETE SET NULL,
  FOREIGN KEY (organization_id, created_by_member_id)
    REFERENCES organization_members (organization_id, id)
);

CREATE UNIQUE INDEX idx_subscription_refunds_idempotency
  ON subscription_refunds (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_subscription_refunds_org_sub
  ON subscription_refunds (organization_id, subscription_id, created_at DESC);

CREATE INDEX idx_subscription_refunds_org_completed
  ON subscription_refunds (organization_id, operation_date DESC)
  WHERE status = 'completed';

-- Allow negative accrual on payroll adjustment lines only
ALTER TABLE teacher_settlement_line_items
  DROP CONSTRAINT IF EXISTS teacher_settlement_line_items_accrual_amount_check;

ALTER TABLE teacher_settlement_line_items
  ADD CONSTRAINT teacher_settlement_line_items_accrual_amount_check
  CHECK (line_category = 'adjustment' OR accrual_amount >= 0);

-- =============================================================================
-- 2. Permission helpers
-- =============================================================================

CREATE OR REPLACE FUNCTION member_can_issue_refunds()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT auth.uid() IS NOT NULL
    AND auth_organization_id() IS NOT NULL
    AND can_read_financial()
    AND organization_allows_writes(auth_organization_id());
$$;

CREATE OR REPLACE FUNCTION member_can_read_refunds()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT auth.uid() IS NOT NULL
    AND auth_organization_id() IS NOT NULL
    AND can_read_financial();
$$;

-- =============================================================================
-- 3. Refund calculation helpers
-- =============================================================================

CREATE OR REPLACE FUNCTION subscription_sale_price(p_org_id uuid, p_sub_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_received numeric := 0;
  v_catalog numeric := 0;
BEGIN
  SELECT COALESCE(SUM(p.amount), 0)
  INTO v_received
  FROM payments p
  WHERE p.organization_id = p_org_id
    AND p.subscription_id = p_sub_id
    AND p.personal_lesson_id IS NULL;

  IF v_received > 0 THEN
    RETURN payroll_round_money(v_received);
  END IF;

  SELECT COALESCE(pr.price, 0)
  INTO v_catalog
  FROM subscriptions s
  LEFT JOIN prices pr
    ON pr.organization_id = s.organization_id
   AND pr.id = s.price_id
  WHERE s.organization_id = p_org_id
    AND s.id = p_sub_id;

  RETURN payroll_round_money(v_catalog);
END;
$$;

CREATE OR REPLACE FUNCTION subscription_refunded_total(
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
    AND sr.status = 'completed'
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
  );
$$;

CREATE OR REPLACE FUNCTION subscription_recommended_refund_amount(p_sub subscriptions)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_sale_price numeric;
  v_available numeric;
  v_recommended numeric;
BEGIN
  IF p_sub.billing_model = 'monthly_unlimited' THEN
    RETURN NULL;
  END IF;

  IF p_sub.lessons_total IS NULL OR p_sub.lessons_total <= 0 THEN
    RETURN NULL;
  END IF;

  v_sale_price := subscription_sale_price(p_sub.organization_id, p_sub.id);
  v_available := subscription_refund_available_amount(p_sub.organization_id, p_sub.id);

  IF v_available <= 0 OR p_sub.lessons_left <= 0 THEN
    RETURN 0;
  END IF;

  v_recommended := payroll_round_money(
    v_sale_price * p_sub.lessons_left::numeric / p_sub.lessons_total::numeric
  );

  RETURN LEAST(v_recommended, v_available);
END;
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

CREATE OR REPLACE FUNCTION subscription_refund_teacher_member_id(
  p_org_id uuid,
  p_sub_id uuid
)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT ct.member_id
  FROM subscription_groups sg
  JOIN class_teachers ct
    ON ct.organization_id = sg.organization_id
   AND ct.class_id = sg.schedule_group_id
  WHERE sg.organization_id = p_org_id
    AND sg.subscription_id = p_sub_id
  ORDER BY sg.schedule_group_id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION apply_subscription_refund_payroll_adjustment(
  p_org_id uuid,
  p_refund_id uuid,
  p_sub_id uuid,
  p_refund_amount numeric,
  p_operation_date date,
  p_payment_created_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_teacher_id uuid;
  v_rate record;
  v_adjustment numeric;
  v_year int;
  v_month int;
  v_settlement_id uuid;
  v_existing_paid numeric;
  v_computed_at timestamptz := now();
BEGIN
  IF p_refund_amount <= 0 THEN
    RETURN;
  END IF;

  v_teacher_id := subscription_refund_teacher_member_id(p_org_id, p_sub_id);
  IF v_teacher_id IS NULL THEN
    RETURN;
  END IF;

  SELECT *
  INTO v_rate
  FROM payroll_rate_row_at_date(
    p_org_id,
    v_teacher_id,
    COALESCE(p_payment_created_at, p_operation_date::timestamptz)::date
  );

  IF NOT FOUND
    OR v_rate.pay_mode NOT IN ('percent', 'fixed_plus_percent')
    OR COALESCE(v_rate.group_rate_percent, 0) <= 0
  THEN
    RETURN;
  END IF;

  v_adjustment := -payroll_percent_accrual(p_refund_amount, v_rate.group_rate_percent);
  IF v_adjustment = 0 THEN
    RETURN;
  END IF;

  v_year := EXTRACT(YEAR FROM p_operation_date)::int;
  v_month := EXTRACT(MONTH FROM p_operation_date)::int;

  SELECT ts.amount_paid, ts.id
  INTO v_existing_paid, v_settlement_id
  FROM teacher_settlements ts
  WHERE ts.organization_id = p_org_id
    AND ts.member_id = v_teacher_id
    AND ts.period_year = v_year
    AND ts.period_month = v_month;

  INSERT INTO teacher_settlements (
    organization_id,
    member_id,
    period_year,
    period_month,
    amount_accrued,
    amount_paid,
    computed_at
  )
  VALUES (
    p_org_id,
    v_teacher_id,
    v_year,
    v_month,
    0,
    COALESCE(v_existing_paid, 0),
    v_computed_at
  )
  ON CONFLICT (organization_id, member_id, period_year, period_month)
  DO UPDATE SET computed_at = v_computed_at
  RETURNING id INTO v_settlement_id;

  INSERT INTO teacher_settlement_line_items (
    organization_id,
    settlement_id,
    member_id,
    line_category,
    source_type,
    source_id,
    line_date,
    title,
    monetary_base,
    pay_mode,
    percent_rate,
    accrual_amount,
    included_in_total,
    sort_at,
    computed_at
  ) VALUES (
    p_org_id,
    v_settlement_id,
    v_teacher_id,
    'adjustment',
    'adjustment',
    p_refund_id,
    p_operation_date,
    'Возврат по абонементу',
    payroll_round_money(p_refund_amount),
    v_rate.pay_mode,
    v_rate.group_rate_percent,
    v_adjustment,
    true,
    p_operation_date::timestamptz,
    v_computed_at
  );

  UPDATE teacher_settlements
  SET amount_accrued = GREATEST(0, COALESCE(amount_accrued, 0) + v_adjustment),
      computed_at = v_computed_at
  WHERE organization_id = p_org_id
    AND id = v_settlement_id;
END;
$$;

-- =============================================================================
-- 4. Preview RPC
-- =============================================================================

CREATE OR REPLACE FUNCTION preview_subscription_refund(p_sub_id text)
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
    'formula', subscription_refund_formula_snapshot(v_sub)
  );
END;
$$;

-- =============================================================================
-- 5. Finish with refund RPC
-- =============================================================================

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

  IF NOT EXISTS (
    SELECT 1 FROM clients c
    WHERE c.organization_id = v_org_id
      AND c.id = p_recipient_client_id
      AND c.id IN (v_sub.client_id1, v_sub.client_id2, v_sub.client_id3, v_sub.client_id4)
  ) THEN
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

  IF v_sub.billing_model = 'monthly_unlimited' AND v_rounded_amount > 0
    AND (v_recommended IS NULL)
  THEN
    -- manual amount allowed with reason (already required)
    NULL;
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
      created_by_member_id
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
      v_member_id
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

-- =============================================================================
-- 6. RLS
-- =============================================================================

ALTER TABLE subscription_refunds ENABLE ROW LEVEL SECURITY;

CREATE POLICY subscription_refunds_select
  ON subscription_refunds FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND member_can_read_refunds()
  );

CREATE POLICY subscription_refunds_insert
  ON subscription_refunds FOR INSERT TO authenticated
  WITH CHECK (false);

CREATE POLICY subscription_refunds_update
  ON subscription_refunds FOR UPDATE TO authenticated
  USING (false);

CREATE POLICY subscription_refunds_delete
  ON subscription_refunds FOR DELETE TO authenticated
  USING (false);

CREATE TRIGGER audit_subscription_refunds
  AFTER INSERT OR UPDATE OR DELETE ON subscription_refunds
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

REVOKE ALL ON FUNCTION member_can_issue_refunds() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_can_issue_refunds() TO authenticated, service_role;

REVOKE ALL ON FUNCTION member_can_read_refunds() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_can_read_refunds() TO authenticated, service_role;

REVOKE ALL ON FUNCTION preview_subscription_refund(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION preview_subscription_refund(text) TO authenticated;

REVOKE ALL ON FUNCTION finish_subscription_with_refund(
  text, uuid, numeric, text, text, text, date, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finish_subscription_with_refund(
  text, uuid, numeric, text, text, text, date, uuid
) TO authenticated;

COMMIT;
