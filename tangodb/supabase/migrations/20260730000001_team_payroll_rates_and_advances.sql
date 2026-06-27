-- Team payroll: pay modes, group/private percentages, fixed salary and advances

BEGIN;

ALTER TABLE teacher_pay_rates
  ADD COLUMN IF NOT EXISTS pay_mode TEXT NOT NULL DEFAULT 'percent'
    CHECK (pay_mode IN ('percent', 'fixed', 'fixed_plus_percent')),
  ADD COLUMN IF NOT EXISTS fixed_amount NUMERIC NOT NULL DEFAULT 0 CHECK (fixed_amount >= 0),
  ADD COLUMN IF NOT EXISTS group_rate_percent NUMERIC CHECK (group_rate_percent >= 0 AND group_rate_percent <= 100),
  ADD COLUMN IF NOT EXISTS personal_rate_percent NUMERIC CHECK (personal_rate_percent >= 0 AND personal_rate_percent <= 100);

UPDATE teacher_pay_rates
SET group_rate_percent = COALESCE(group_rate_percent, rate_percent),
    personal_rate_percent = COALESCE(personal_rate_percent, rate_percent)
WHERE group_rate_percent IS NULL OR personal_rate_percent IS NULL;

ALTER TABLE teacher_pay_rates
  ALTER COLUMN group_rate_percent SET DEFAULT 0,
  ALTER COLUMN personal_rate_percent SET DEFAULT 0,
  ALTER COLUMN group_rate_percent SET NOT NULL,
  ALTER COLUMN personal_rate_percent SET NOT NULL;

DO $$
DECLARE
  v_constraint text;
BEGIN
  SELECT conname INTO v_constraint
  FROM pg_constraint
  WHERE conrelid = 'teacher_settlements'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%amount_paid <= amount_accrued%'
  LIMIT 1;

  IF v_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE teacher_settlements DROP CONSTRAINT %I', v_constraint);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_tenant_row_org_consistency()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'class_teachers' THEN
    IF NOT EXISTS (
      SELECT 1 FROM classes c
      WHERE c.organization_id = NEW.organization_id AND c.id = NEW.class_id
    ) THEN
      RAISE EXCEPTION 'class_id does not belong to organization';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = NEW.organization_id AND om.id = NEW.member_id
    ) THEN
      RAISE EXCEPTION 'member_id does not belong to organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'subscriptions' THEN
    IF NEW.discipline_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM disciplines d
      WHERE d.organization_id = NEW.organization_id AND d.id = NEW.discipline_id
    ) THEN
      RAISE EXCEPTION 'discipline_id does not belong to organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'attendance' THEN
    IF NOT EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.organization_id = NEW.organization_id AND s.id = NEW.subscription_id
    ) THEN
      RAISE EXCEPTION 'subscription_id does not belong to organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'personal_lessons' THEN
    IF NEW.subscription_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.organization_id = NEW.organization_id AND s.id = NEW.subscription_id
    ) THEN
      RAISE EXCEPTION 'subscription_id does not belong to organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'schedule_slots' THEN
    IF NEW.discipline_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM disciplines d
      WHERE d.organization_id = NEW.organization_id AND d.id = NEW.discipline_id
    ) THEN
      RAISE EXCEPTION 'discipline_id does not belong to organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'payments' THEN
    IF NOT EXISTS (
      SELECT 1 FROM clients c
      WHERE c.organization_id = NEW.organization_id AND c.id = NEW.client_id
    ) THEN
      RAISE EXCEPTION 'client_id does not belong to organization';
    END IF;
    IF NEW.subscription_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.organization_id = NEW.organization_id AND s.id = NEW.subscription_id
    ) THEN
      RAISE EXCEPTION 'subscription_id does not belong to organization';
    END IF;
    IF NEW.personal_lesson_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM personal_lessons pl
      WHERE pl.organization_id = NEW.organization_id AND pl.id = NEW.personal_lesson_id
    ) THEN
      RAISE EXCEPTION 'personal_lesson_id does not belong to organization';
    END IF;
    IF NEW.created_by IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = NEW.organization_id AND om.id = NEW.created_by
    ) THEN
      RAISE EXCEPTION 'created_by does not belong to organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'expenses' THEN
    IF NEW.created_by IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = NEW.organization_id AND om.id = NEW.created_by
    ) THEN
      RAISE EXCEPTION 'created_by does not belong to organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'teacher_pay_rates' THEN
    IF NOT EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = NEW.organization_id
        AND om.id = NEW.member_id
        AND om.is_active = true
    ) THEN
      RAISE EXCEPTION 'member_id must be an active team member in organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'teacher_settlements' THEN
    IF NOT EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = NEW.organization_id AND om.id = NEW.member_id
    ) THEN
      RAISE EXCEPTION 'member_id does not belong to organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'teacher_settlement_payments' THEN
    IF NOT EXISTS (
      SELECT 1 FROM teacher_settlements ts
      WHERE ts.organization_id = NEW.organization_id AND ts.id = NEW.settlement_id
    ) THEN
      RAISE EXCEPTION 'settlement_id does not belong to organization';
    END IF;
    IF NEW.created_by IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = NEW.organization_id AND om.id = NEW.created_by
    ) THEN
      RAISE EXCEPTION 'created_by does not belong to organization';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION recalculate_teacher_settlement(
  p_org_id uuid,
  p_year int,
  p_month int
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_date_from date;
  v_date_to date;
  v_member record;
  v_pay_mode text;
  v_rate_fixed_amount numeric;
  v_rate_group_percent numeric;
  v_rate_personal_percent numeric;
  v_fixed_amount numeric;
  v_group_percent numeric;
  v_personal_percent numeric;
  v_accrued numeric;
  v_existing_paid numeric;
BEGIN
  IF p_org_id IS NULL
    OR p_org_id <> auth_organization_id()
    OR NOT can_write_payroll()
    OR NOT organization_allows_writes(p_org_id)
  THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  IF p_month < 1 OR p_month > 12 THEN
    RAISE EXCEPTION 'invalid month';
  END IF;

  v_date_from := make_date(p_year, p_month, 1);
  v_date_to := (v_date_from + interval '1 month' - interval '1 day')::date;

  FOR v_member IN
    SELECT om.id AS member_id
    FROM organization_members om
    WHERE om.organization_id = p_org_id
      AND om.role IN ('owner', 'director', 'admin', 'teacher', 'accountant')
      AND om.is_active = true
  LOOP
    SELECT
      tpr.pay_mode,
      tpr.fixed_amount,
      tpr.group_rate_percent,
      tpr.personal_rate_percent
    INTO v_pay_mode, v_rate_fixed_amount, v_rate_group_percent, v_rate_personal_percent
    FROM teacher_pay_rates tpr
    WHERE tpr.organization_id = p_org_id
      AND tpr.member_id = v_member.member_id
      AND tpr.effective_from <= v_date_to
    ORDER BY tpr.effective_from DESC, tpr.created_at DESC
    LIMIT 1;

    v_fixed_amount := CASE
      WHEN COALESCE(v_pay_mode, 'percent') IN ('fixed', 'fixed_plus_percent')
        THEN COALESCE(v_rate_fixed_amount, 0)
      ELSE 0
    END;
    v_group_percent := CASE
      WHEN COALESCE(v_pay_mode, 'percent') IN ('percent', 'fixed_plus_percent')
        THEN COALESCE(v_rate_group_percent, 0)
      ELSE 0
    END;
    v_personal_percent := CASE
      WHEN COALESCE(v_pay_mode, 'percent') IN ('percent', 'fixed_plus_percent')
        THEN COALESCE(v_rate_personal_percent, 0)
      ELSE 0
    END;

    SELECT v_fixed_amount + COALESCE(SUM(
      p.amount * CASE
        WHEN p.personal_lesson_id IS NOT NULL THEN v_personal_percent
        WHEN p.subscription_id IS NOT NULL THEN v_group_percent
        ELSE 0
      END / 100.0
    ), 0)
    INTO v_accrued
    FROM payments p
    WHERE p.organization_id = p_org_id
      AND p.created_at >= v_date_from
      AND p.created_at < (v_date_to + interval '1 day')
      AND payroll_resolve_payment_teacher_id(
        p_org_id,
        p.personal_lesson_id,
        p.subscription_id
      ) = v_member.member_id;

    SELECT ts.amount_paid
    INTO v_existing_paid
    FROM teacher_settlements ts
    WHERE ts.organization_id = p_org_id
      AND ts.member_id = v_member.member_id
      AND ts.period_year = p_year
      AND ts.period_month = p_month;

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
      v_member.member_id,
      p_year,
      p_month,
      COALESCE(v_accrued, 0),
      COALESCE(v_existing_paid, 0),
      now()
    )
    ON CONFLICT (organization_id, member_id, period_year, period_month)
    DO UPDATE SET
      amount_accrued = EXCLUDED.amount_accrued,
      computed_at = now();
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION record_teacher_settlement_payment(
  p_settlement_id uuid,
  p_amount numeric,
  p_paid_at date,
  p_method text DEFAULT 'transfer',
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_settlement teacher_settlements%ROWTYPE;
  v_payment_id uuid;
  v_new_paid numeric;
BEGIN
  IF v_org_id IS NULL
    OR NOT can_write_payroll()
    OR NOT organization_allows_writes(v_org_id)
  THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid amount';
  END IF;

  IF p_paid_at IS NULL OR p_paid_at > CURRENT_DATE THEN
    RAISE EXCEPTION 'paid_at cannot be in the future';
  END IF;

  IF p_method NOT IN ('cash', 'transfer', 'card', 'other') THEN
    RAISE EXCEPTION 'invalid method';
  END IF;

  SELECT * INTO v_settlement
  FROM teacher_settlements ts
  WHERE ts.id = p_settlement_id
    AND ts.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'settlement not found';
  END IF;

  v_new_paid := v_settlement.amount_paid + p_amount;

  INSERT INTO teacher_settlement_payments (
    organization_id,
    settlement_id,
    amount,
    paid_at,
    method,
    note,
    created_by
  )
  VALUES (
    v_org_id,
    p_settlement_id,
    p_amount,
    p_paid_at,
    p_method,
    nullif(trim(p_note), ''),
    auth_member_id()
  )
  RETURNING id INTO v_payment_id;

  UPDATE teacher_settlements
  SET amount_paid = v_new_paid
  WHERE id = p_settlement_id;

  RETURN v_payment_id;
END;
$$;

COMMIT;
