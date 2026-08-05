-- Flexible teacher pay / studio deduction rules (team profile).
-- Group revenue from attendance; payroll from closures + single visits; expense categorization.

BEGIN;

-- =============================================================================
-- 1. teacher_pay_rules
-- =============================================================================

CREATE TABLE teacher_pay_rules (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  member_id           UUID NOT NULL,
  lesson_kind         TEXT NOT NULL
    CHECK (lesson_kind IN ('personal', 'group', 'single_visit', 'all')),
  discipline_id       UUID,
  schedule_group_id   UUID,
  amount_type         TEXT NOT NULL CHECK (amount_type IN ('percent', 'fixed')),
  value               NUMERIC NOT NULL CHECK (value >= 0),
  expense_category    TEXT CHECK (
    expense_category IS NULL
    OR expense_category IN ('rent', 'utilities', 'marketing', 'other')
  ),
  valid_from          DATE NOT NULL,
  valid_to            DATE,
  created_by          UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, discipline_id)
    REFERENCES disciplines (organization_id, id),
  FOREIGN KEY (organization_id, schedule_group_id)
    REFERENCES classes (organization_id, id),
  FOREIGN KEY (organization_id, created_by)
    REFERENCES organization_members (organization_id, id),
  CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CHECK (amount_type <> 'percent' OR value <= 100)
);

CREATE INDEX idx_teacher_pay_rules_org_member_dates
  ON teacher_pay_rules (organization_id, member_id, valid_from, valid_to);

CREATE OR REPLACE FUNCTION teacher_pay_rule_scope_key(
  p_lesson_kind text,
  p_discipline_id uuid,
  p_schedule_group_id uuid
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT concat_ws(
    ':',
    p_lesson_kind,
    COALESCE(p_discipline_id::text, '*'),
    COALESCE(p_schedule_group_id::text, '*')
  );
$$;

CREATE OR REPLACE FUNCTION teacher_pay_rule_specificity(
  p_discipline_id uuid,
  p_schedule_group_id uuid
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    (CASE WHEN p_schedule_group_id IS NOT NULL THEN 4 ELSE 0 END)
    + (CASE WHEN p_discipline_id IS NOT NULL THEN 2 ELSE 0 END);
$$;

CREATE OR REPLACE FUNCTION teacher_pay_rules_overlap(
  p_org_id uuid,
  p_member_id uuid,
  p_lesson_kind text,
  p_discipline_id uuid,
  p_schedule_group_id uuid,
  p_valid_from date,
  p_valid_to date,
  p_exclude_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM teacher_pay_rules r
    WHERE r.organization_id = p_org_id
      AND r.member_id = p_member_id
      AND r.lesson_kind = p_lesson_kind
      AND r.discipline_id IS NOT DISTINCT FROM p_discipline_id
      AND r.schedule_group_id IS NOT DISTINCT FROM p_schedule_group_id
      AND (p_exclude_id IS NULL OR r.id <> p_exclude_id)
      AND daterange(r.valid_from, COALESCE(r.valid_to, 'infinity'::date), '[]')
          && daterange(p_valid_from, COALESCE(p_valid_to, 'infinity'::date), '[]')
  );
$$;

CREATE OR REPLACE FUNCTION teacher_pay_rule_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_early_end boolean := COALESCE(NULLIF(current_setting('app.teacher_pay_rule_allow_early_end', true), ''), 'off') = 'on';
BEGIN
  IF TG_OP = 'UPDATE' AND v_early_end
    AND NEW.organization_id = OLD.organization_id
    AND NEW.member_id = OLD.member_id
    AND NEW.lesson_kind = OLD.lesson_kind
    AND NEW.discipline_id IS NOT DISTINCT FROM OLD.discipline_id
    AND NEW.schedule_group_id IS NOT DISTINCT FROM OLD.schedule_group_id
    AND NEW.amount_type = OLD.amount_type
    AND NEW.value = OLD.value
    AND NEW.expense_category IS NOT DISTINCT FROM OLD.expense_category
    AND NEW.valid_from = OLD.valid_from
    AND NEW.valid_to IS DISTINCT FROM OLD.valid_to
  THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF teacher_pay_rules_overlap(
    NEW.organization_id,
    NEW.member_id,
    NEW.lesson_kind,
    NEW.discipline_id,
    NEW.schedule_group_id,
    NEW.valid_from,
    NEW.valid_to,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.id ELSE NULL END
  ) THEN
    RAISE EXCEPTION 'teacher_pay_rule_overlap' USING ERRCODE = '23P01';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER teacher_pay_rule_guard_trigger
  BEFORE INSERT OR UPDATE ON teacher_pay_rules
  FOR EACH ROW EXECUTE FUNCTION teacher_pay_rule_guard();

CREATE TRIGGER audit_teacher_pay_rules
  AFTER INSERT OR UPDATE OR DELETE ON teacher_pay_rules
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

ALTER TABLE teacher_pay_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY teacher_pay_rules_select ON teacher_pay_rules
  FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND (
      can_read_financial()
      OR member_id = auth_member_id()
    )
  );

CREATE POLICY teacher_pay_rules_write_none ON teacher_pay_rules
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

REVOKE ALL ON teacher_pay_rules FROM PUBLIC, anon;
GRANT SELECT ON teacher_pay_rules TO authenticated;

-- =============================================================================
-- 2. Revenue + rule resolution
-- =============================================================================

CREATE OR REPLACE FUNCTION group_occurrence_revenue(
  p_org_id uuid,
  p_schedule_slot_id uuid,
  p_occurrence_date date
)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(sum(
    CASE
      WHEN s.billing_model = 'lesson_count'
        AND s.lessons_total > 0
        AND pr.price IS NOT NULL
      THEN pr.price / s.lessons_total
      ELSE 0
    END
  ), 0)
  FROM schedule_slots ss
  JOIN attendance a
    ON a.organization_id = ss.organization_id
   AND a.schedule_group_id = ss.class_id
   AND a.date = p_occurrence_date
   AND a.attendance_status = 'present'
  JOIN subscriptions s
    ON s.organization_id = a.organization_id
   AND s.id = a.subscription_id
  LEFT JOIN prices pr
    ON pr.organization_id = s.organization_id
   AND pr.id = s.price_id
  WHERE ss.organization_id = p_org_id
    AND ss.id = p_schedule_slot_id;
$$;

CREATE OR REPLACE FUNCTION occurrence_revenue_for_closure(p_closure lesson_occurrence_closures)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_price numeric;
BEGIN
  IF p_closure.status <> 'closed' THEN
    RETURN 0;
  END IF;

  IF p_closure.occurrence_kind = 'personal' THEN
    SELECT pl.price INTO v_price
    FROM personal_lessons pl
    WHERE pl.organization_id = p_closure.organization_id
      AND pl.id = COALESCE(p_closure.source_personal_lesson_id, p_closure.personal_lesson_id);
    RETURN COALESCE(v_price, 0);
  END IF;

  IF p_closure.schedule_slot_id IS NULL THEN
    RETURN 0;
  END IF;

  RETURN group_occurrence_revenue(
    p_closure.organization_id,
    p_closure.schedule_slot_id,
    p_closure.occurrence_date
  );
END;
$$;

CREATE OR REPLACE FUNCTION resolve_teacher_pay_rule(
  p_org_id uuid,
  p_member_id uuid,
  p_lesson_kind text,
  p_discipline_id uuid,
  p_schedule_group_id uuid,
  p_on_date date
)
RETURNS teacher_pay_rules
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT r.*
  FROM teacher_pay_rules r
  WHERE r.organization_id = p_org_id
    AND r.member_id = p_member_id
    AND r.lesson_kind IN (p_lesson_kind, 'all')
    AND r.valid_from <= p_on_date
    AND (r.valid_to IS NULL OR r.valid_to >= p_on_date)
    AND (r.discipline_id IS NULL OR r.discipline_id = p_discipline_id)
    AND (r.schedule_group_id IS NULL OR r.schedule_group_id = p_schedule_group_id)
  ORDER BY
    teacher_pay_rule_specificity(r.discipline_id, r.schedule_group_id) DESC,
    CASE WHEN r.schedule_group_id IS NULL THEN 1 ELSE 0 END,
    CASE WHEN r.discipline_id IS NULL THEN 1 ELSE 0 END,
    r.valid_from DESC,
    r.created_at DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION teacher_pay_studio_deduction(
  p_rule teacher_pay_rules,
  p_revenue numeric
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_rule.id IS NULL OR COALESCE(p_revenue, 0) <= 0 THEN 0
    WHEN p_rule.amount_type = 'percent' THEN payroll_round_money(p_revenue * p_rule.value / 100.0)
    ELSE LEAST(payroll_round_money(p_rule.value), payroll_round_money(p_revenue))
  END;
$$;

CREATE OR REPLACE FUNCTION teacher_pay_teacher_accrual(
  p_revenue numeric,
  p_rule teacher_pay_rules,
  p_legacy_percent numeric DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_revenue numeric := COALESCE(p_revenue, 0);
  v_deduction numeric;
BEGIN
  IF v_revenue <= 0 THEN
    RETURN 0;
  END IF;

  IF p_rule.id IS NOT NULL THEN
    v_deduction := teacher_pay_studio_deduction(p_rule, v_revenue);
    RETURN GREATEST(payroll_round_money(v_revenue - v_deduction), 0);
  END IF;

  IF p_legacy_percent IS NULL OR p_legacy_percent <= 0 THEN
    RETURN 0;
  END IF;

  RETURN payroll_percent_accrual(v_revenue, p_legacy_percent);
END;
$$;

-- =============================================================================
-- 3. venue_cost_accruals extension + finance view
-- =============================================================================

ALTER TABLE venue_cost_accruals
  ADD COLUMN IF NOT EXISTS teacher_pay_rule_id UUID,
  ADD COLUMN IF NOT EXISTS single_visit_id UUID;

ALTER TABLE venue_cost_accruals
  DROP CONSTRAINT IF EXISTS venue_cost_accruals_organization_id_teacher_pay_rule_id_fkey;

ALTER TABLE venue_cost_accruals
  ADD CONSTRAINT venue_cost_accruals_organization_id_teacher_pay_rule_id_fkey
  FOREIGN KEY (organization_id, teacher_pay_rule_id)
  REFERENCES teacher_pay_rules (organization_id, id);

ALTER TABLE venue_cost_accruals
  DROP CONSTRAINT IF EXISTS venue_cost_accruals_organization_id_single_visit_id_fkey;

ALTER TABLE venue_cost_accruals
  ADD CONSTRAINT venue_cost_accruals_organization_id_single_visit_id_fkey
  FOREIGN KEY (organization_id, single_visit_id)
  REFERENCES single_visits (organization_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS venue_cost_teacher_pay_closure_unique
  ON venue_cost_accruals (organization_id, closure_id, teacher_pay_rule_id)
  WHERE teacher_pay_rule_id IS NOT NULL
    AND closure_id IS NOT NULL
    AND accrual_status = 'posted';

CREATE UNIQUE INDEX IF NOT EXISTS venue_cost_teacher_pay_visit_unique
  ON venue_cost_accruals (organization_id, single_visit_id, teacher_pay_rule_id)
  WHERE teacher_pay_rule_id IS NOT NULL
    AND single_visit_id IS NOT NULL
    AND accrual_status = 'posted';

CREATE OR REPLACE FUNCTION post_teacher_pay_deduction_for_closure(
  p_closure_id uuid,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_closure lesson_occurrence_closures%ROWTYPE;
  v_rule teacher_pay_rules%ROWTYPE;
  v_revenue numeric;
  v_deduction numeric;
  v_schedule_group_id uuid;
  v_accrual_id uuid;
BEGIN
  SELECT * INTO v_closure
  FROM lesson_occurrence_closures
  WHERE id = p_closure_id
  FOR UPDATE;

  IF NOT FOUND OR v_closure.status <> 'closed' OR v_closure.teacher_member_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'closure_not_found');
  END IF;

  IF EXISTS (
    SELECT 1 FROM venue_cost_accruals a
    WHERE a.organization_id = v_closure.organization_id
      AND a.closure_id = v_closure.id
      AND a.teacher_pay_rule_id IS NOT NULL
      AND a.accrual_status = 'posted'
  ) THEN
    RETURN jsonb_build_object('success', true, 'already_applied', true);
  END IF;

  v_revenue := occurrence_revenue_for_closure(v_closure);
  IF v_revenue <= 0 THEN
    RETURN jsonb_build_object('success', true, 'skipped', true, 'reason', 'zero_revenue');
  END IF;

  SELECT ss.class_id INTO v_schedule_group_id
  FROM schedule_slots ss
  WHERE ss.organization_id = v_closure.organization_id
    AND ss.id = v_closure.schedule_slot_id;

  SELECT * INTO v_rule
  FROM resolve_teacher_pay_rule(
    v_closure.organization_id,
    v_closure.teacher_member_id,
    v_closure.occurrence_kind,
    v_closure.discipline_id,
    v_schedule_group_id,
    v_closure.occurrence_date
  );

  IF v_rule.id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'skipped', true, 'reason', 'no_rule');
  END IF;

  v_deduction := teacher_pay_studio_deduction(v_rule, v_revenue);
  IF v_deduction <= 0 THEN
    RETURN jsonb_build_object('success', true, 'skipped', true, 'reason', 'zero_deduction');
  END IF;

  INSERT INTO venue_cost_accruals (
    organization_id, teacher_pay_rule_id, closure_id, accrual_kind, accrual_status,
    accrual_date, amount, currency, rule_snapshot, source_snapshot, created_by
  ) VALUES (
    v_closure.organization_id, v_rule.id, v_closure.id, 'lesson', 'posted',
    v_closure.occurrence_date, v_deduction,
    COALESCE((
      SELECT os.currency_code FROM organization_settings os
      WHERE os.organization_id = v_closure.organization_id
    ), 'RUB'),
    to_jsonb(v_rule),
    jsonb_build_object(
      'closure_id', v_closure.id,
      'occurrence_kind', v_closure.occurrence_kind,
      'revenue', v_revenue,
      'teacher_member_id', v_closure.teacher_member_id
    ),
    p_actor_id
  )
  RETURNING id INTO v_accrual_id;

  RETURN jsonb_build_object(
    'success', true,
    'accrual_id', v_accrual_id,
    'amount', v_deduction,
    'teacher_pay_rule_id', v_rule.id
  );
END;
$$;

CREATE OR REPLACE FUNCTION post_teacher_pay_deduction_for_single_visit(
  p_visit_id uuid,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_visit single_visits%ROWTYPE;
  v_rule teacher_pay_rules%ROWTYPE;
  v_deduction numeric;
  v_accrual_id uuid;
BEGIN
  SELECT * INTO v_visit
  FROM single_visits
  WHERE id = p_visit_id
  FOR UPDATE;

  IF NOT FOUND OR v_visit.teacher_member_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'visit_not_found');
  END IF;

  IF EXISTS (
    SELECT 1 FROM venue_cost_accruals a
    WHERE a.organization_id = v_visit.organization_id
      AND a.single_visit_id = v_visit.id
      AND a.teacher_pay_rule_id IS NOT NULL
      AND a.accrual_status = 'posted'
  ) THEN
    RETURN jsonb_build_object('success', true, 'already_applied', true);
  END IF;

  IF COALESCE(v_visit.amount, 0) <= 0 THEN
    RETURN jsonb_build_object('success', true, 'skipped', true, 'reason', 'zero_revenue');
  END IF;

  SELECT * INTO v_rule
  FROM resolve_teacher_pay_rule(
    v_visit.organization_id,
    v_visit.teacher_member_id,
    'single_visit',
    v_visit.discipline_id,
    v_visit.schedule_group_id,
    v_visit.visit_date
  );

  IF v_rule.id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'skipped', true, 'reason', 'no_rule');
  END IF;

  v_deduction := teacher_pay_studio_deduction(v_rule, v_visit.amount);
  IF v_deduction <= 0 THEN
    RETURN jsonb_build_object('success', true, 'skipped', true, 'reason', 'zero_deduction');
  END IF;

  INSERT INTO venue_cost_accruals (
    organization_id, teacher_pay_rule_id, single_visit_id, accrual_kind, accrual_status,
    accrual_date, amount, currency, rule_snapshot, source_snapshot, created_by
  ) VALUES (
    v_visit.organization_id, v_rule.id, v_visit.id, 'lesson', 'posted',
    v_visit.visit_date, v_deduction,
    COALESCE((
      SELECT os.currency_code FROM organization_settings os
      WHERE os.organization_id = v_visit.organization_id
    ), 'RUB'),
    to_jsonb(v_rule),
    jsonb_build_object(
      'single_visit_id', v_visit.id,
      'revenue', v_visit.amount,
      'teacher_member_id', v_visit.teacher_member_id
    ),
    p_actor_id
  )
  RETURNING id INTO v_accrual_id;

  RETURN jsonb_build_object(
    'success', true,
    'accrual_id', v_accrual_id,
    'amount', v_deduction,
    'teacher_pay_rule_id', v_rule.id
  );
END;
$$;

DROP VIEW IF EXISTS finance_cost_entries_v;

CREATE VIEW finance_cost_entries_v
WITH (security_invoker = true)
AS
SELECT
  e.organization_id,
  e.id,
  'manual_expense'::text AS source_type,
  e.expense_date AS entry_date,
  e.amount::numeric(14, 2) AS amount,
  e.category,
  e.description,
  NULL::uuid AS rule_version_id,
  NULL::uuid AS closure_id,
  NULL::uuid AS teacher_pay_rule_id,
  e.created_at
FROM expenses e
UNION ALL
SELECT
  a.organization_id,
  a.id,
  'venue_cost'::text AS source_type,
  a.accrual_date AS entry_date,
  a.amount,
  COALESCE(tpr.expense_category, 'venue')::text AS category,
  COALESCE(
    a.reason,
    CASE
      WHEN tpr.id IS NOT NULL THEN 'teacher_pay_deduction'
      ELSE a.accrual_kind
    END
  ) AS description,
  a.rule_version_id,
  a.closure_id,
  a.teacher_pay_rule_id,
  a.created_at
FROM venue_cost_accruals a
LEFT JOIN teacher_pay_rules tpr
  ON tpr.organization_id = a.organization_id
 AND tpr.id = a.teacher_pay_rule_id
WHERE a.accrual_status = 'posted';

REVOKE ALL ON finance_cost_entries_v FROM PUBLIC, anon;
GRANT SELECT ON finance_cost_entries_v TO authenticated;

-- =============================================================================
-- 4. RPCs: save / list / end early
-- =============================================================================

CREATE OR REPLACE FUNCTION list_teacher_pay_rules(p_member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  IF NOT can_read_financial() AND auth_member_id() IS DISTINCT FROM p_member_id THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'rules', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.valid_from DESC, r.created_at DESC)
      FROM teacher_pay_rules r
      WHERE r.organization_id = v_org_id
        AND r.member_id = p_member_id
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION save_teacher_pay_rule(
  p_payload jsonb,
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
  v_rule_id uuid := NULLIF(p_payload ->> 'id', '')::uuid;
  v_teacher_member_id uuid := NULLIF(p_payload ->> 'member_id', '')::uuid;
  v_lesson_kind text := NULLIF(p_payload ->> 'lesson_kind', '');
  v_discipline_id uuid := NULLIF(p_payload ->> 'discipline_id', '')::uuid;
  v_schedule_group_id uuid := NULLIF(p_payload ->> 'schedule_group_id', '')::uuid;
  v_amount_type text := NULLIF(p_payload ->> 'amount_type', '');
  v_value numeric := NULLIF(p_payload ->> 'value', '')::numeric;
  v_expense_category text := NULLIF(p_payload ->> 'expense_category', '');
  v_valid_from date := NULLIF(p_payload ->> 'valid_from', '')::date;
  v_valid_to date := NULLIF(p_payload ->> 'valid_to', '')::date;
  v_result jsonb;
  v_cached jsonb;
  v_fingerprint text := md5(COALESCE(p_payload::text, ''));
  v_saved teacher_pay_rules%ROWTYPE;
BEGIN
  v_cached := check_operation_idempotency(v_org_id, 'save_teacher_pay_rule', p_idempotency_key, v_fingerprint);
  IF v_cached IS NOT NULL THEN
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL OR current_member_role() NOT IN ('owner', 'director') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  IF v_teacher_member_id IS NULL
    OR v_lesson_kind NOT IN ('personal', 'group', 'single_visit', 'all')
    OR v_amount_type NOT IN ('percent', 'fixed')
    OR v_value IS NULL OR v_value < 0
    OR v_valid_from IS NULL
    OR (v_valid_to IS NOT NULL AND v_valid_to < v_valid_from)
    OR (v_amount_type = 'percent' AND v_value > 100)
  THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_payload');
  END IF;

  IF v_expense_category IS NOT NULL
    AND v_expense_category NOT IN ('rent', 'utilities', 'marketing', 'other')
  THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_expense_category');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM organization_members om
    WHERE om.organization_id = v_org_id AND om.id = v_teacher_member_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'member_not_found');
  END IF;

  IF v_discipline_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM disciplines d WHERE d.organization_id = v_org_id AND d.id = v_discipline_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_discipline');
  END IF;

  IF v_schedule_group_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM classes c WHERE c.organization_id = v_org_id AND c.id = v_schedule_group_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_schedule_group');
  END IF;

  IF v_rule_id IS NOT NULL THEN
    UPDATE teacher_pay_rules r
    SET
      lesson_kind = v_lesson_kind,
      discipline_id = v_discipline_id,
      schedule_group_id = v_schedule_group_id,
      amount_type = v_amount_type,
      value = v_value,
      expense_category = v_expense_category,
      valid_from = v_valid_from,
      valid_to = v_valid_to
    WHERE r.id = v_rule_id
      AND r.organization_id = v_org_id
      AND r.member_id = v_teacher_member_id
    RETURNING * INTO v_saved;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'rule_not_found');
    END IF;
  ELSE
    INSERT INTO teacher_pay_rules (
      organization_id, member_id, lesson_kind, discipline_id, schedule_group_id,
      amount_type, value, expense_category, valid_from, valid_to, created_by
    ) VALUES (
      v_org_id, v_teacher_member_id, v_lesson_kind, v_discipline_id, v_schedule_group_id,
      v_amount_type, v_value, v_expense_category, v_valid_from, v_valid_to, v_member_id
    )
    RETURNING * INTO v_saved;
  END IF;

  v_result := jsonb_build_object('success', true, 'rule_id', v_saved.id, 'rule', to_jsonb(v_saved));
  PERFORM store_operation_idempotency(v_org_id, 'save_teacher_pay_rule', p_idempotency_key, v_fingerprint, v_result);
  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM LIKE '%teacher_pay_rule_overlap%' THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'rule_overlap');
    END IF;
    RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION end_teacher_pay_rule_early(
  p_rule_id uuid,
  p_end_date date DEFAULT current_date,
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_rule teacher_pay_rules%ROWTYPE;
  v_result jsonb;
  v_cached jsonb;
  v_fingerprint text := md5(concat_ws('|', p_rule_id, p_end_date));
BEGIN
  v_cached := check_operation_idempotency(v_org_id, 'end_teacher_pay_rule_early', p_idempotency_key, v_fingerprint);
  IF v_cached IS NOT NULL THEN
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL OR current_member_role() NOT IN ('owner', 'director') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  IF p_end_date IS NULL OR p_end_date < current_date THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'end_date_in_past');
  END IF;

  SELECT * INTO v_rule
  FROM teacher_pay_rules
  WHERE id = p_rule_id AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'rule_not_found');
  END IF;

  IF p_end_date < v_rule.valid_from THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'end_date_before_start');
  END IF;

  IF v_rule.valid_to IS NOT NULL AND p_end_date >= v_rule.valid_to THEN
    RETURN jsonb_build_object('success', true, 'rule_id', v_rule.id, 'already_applied', true);
  END IF;

  PERFORM set_config('app.teacher_pay_rule_allow_early_end', 'on', true);
  UPDATE teacher_pay_rules SET valid_to = p_end_date WHERE id = v_rule.id;
  PERFORM set_config('app.teacher_pay_rule_allow_early_end', 'off', true);

  v_result := jsonb_build_object('success', true, 'rule_id', v_rule.id, 'valid_to', p_end_date);
  PERFORM store_operation_idempotency(v_org_id, 'end_teacher_pay_rule_early', p_idempotency_key, v_fingerprint, v_result);
  RETURN v_result;
END;
$$;

-- =============================================================================
-- 5. Hook closure / single visit posting
-- =============================================================================

CREATE OR REPLACE FUNCTION post_venue_cost_for_closure_impl(
  p_closure_id uuid,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_closure lesson_occurrence_closures%ROWTYPE;
  v_rule venue_cost_rule_versions%ROWTYPE;
  v_amount numeric;
  v_accrual_id uuid;
BEGIN
  SELECT * INTO v_closure
  FROM lesson_occurrence_closures
  WHERE id = p_closure_id
  FOR UPDATE;

  IF NOT FOUND OR v_closure.status <> 'closed' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'closure_not_found');
  END IF;

  IF EXISTS (
    SELECT 1 FROM venue_cost_accruals a
    WHERE a.organization_id = v_closure.organization_id
      AND a.closure_id = v_closure.id
      AND a.accrual_status = 'posted'
      AND a.teacher_pay_rule_id IS NULL
      AND a.rule_version_id IS NOT NULL
  ) THEN
    RETURN jsonb_build_object('success', true, 'already_applied', true);
  END IF;

  SELECT * INTO v_rule
  FROM venue_cost_rule_at(v_closure.organization_id, v_closure.occurrence_date);

  IF v_rule.id IS NULL THEN
    INSERT INTO venue_cost_accruals (
      organization_id, closure_id, accrual_kind, accrual_status, accrual_date,
      source_snapshot, created_by
    ) VALUES (
      v_closure.organization_id, v_closure.id, 'lesson', 'pending_unpriced',
      v_closure.occurrence_date, v_closure.source_snapshot, p_actor_id
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_accrual_id;

    UPDATE lesson_occurrence_closures
    SET pricing_status = 'pending_unpriced', rule_version_id = NULL
    WHERE id = v_closure.id;

    RETURN jsonb_build_object(
      'success', true, 'closure_id', v_closure.id, 'accrual_id', v_accrual_id,
      'pricing_status', 'pending_unpriced'
    );
  END IF;

  v_amount := venue_cost_amount_for_lesson(
    v_rule, v_closure.occurrence_kind, v_closure.discipline_id, v_closure.location_id,
    v_closure.confirmed_attendee_count, v_closure.teacher_member_id
  );

  UPDATE venue_cost_accruals
  SET accrual_status = 'void', amount = 0,
      reason = 'resolved_by_rule:' || v_rule.id::text
  WHERE organization_id = v_closure.organization_id
    AND closure_id = v_closure.id
    AND accrual_status = 'pending_unpriced';

  INSERT INTO venue_cost_accruals (
    organization_id, rule_version_id, closure_id, accrual_kind, accrual_status,
    accrual_date, amount, currency, rule_snapshot, source_snapshot, created_by
  ) VALUES (
    v_closure.organization_id, v_rule.id, v_closure.id, 'lesson', 'posted',
    v_closure.occurrence_date, round(v_amount, 2),
    COALESCE(NULLIF(v_rule.rules ->> 'currency', ''), 'RUB'),
    to_jsonb(v_rule), v_closure.source_snapshot, p_actor_id
  )
  RETURNING id INTO v_accrual_id;

  UPDATE lesson_occurrence_closures
  SET pricing_status = CASE WHEN v_rule.mode = 'per_lesson' THEN 'priced' ELSE 'not_applicable' END,
      rule_version_id = v_rule.id
  WHERE id = v_closure.id;

  RETURN jsonb_build_object(
    'success', true, 'closure_id', v_closure.id, 'accrual_id', v_accrual_id,
    'pricing_status', CASE WHEN v_rule.mode = 'per_lesson' THEN 'priced' ELSE 'not_applicable' END,
    'amount', round(v_amount, 2), 'rule_version_id', v_rule.id
  );
END;
$$;

CREATE OR REPLACE FUNCTION post_venue_cost_for_closure(
  p_closure_id uuid,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := post_venue_cost_for_closure_impl(p_closure_id, p_actor_id);
  PERFORM post_teacher_pay_deduction_for_closure(p_closure_id, p_actor_id);
  RETURN v_result;
END;
$$;

-- Patch record_single_visit wrapper to post teacher deduction
DROP FUNCTION IF EXISTS record_single_visit(date, uuid, uuid, uuid, text, uuid, numeric, boolean);

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
-- 6. Payroll: closures + single visits (legacy fallback)
-- =============================================================================

ALTER TABLE teacher_settlement_line_items
  DROP CONSTRAINT IF EXISTS teacher_settlement_line_items_source_type_check;

ALTER TABLE teacher_settlement_line_items
  ADD CONSTRAINT teacher_settlement_line_items_source_type_check
  CHECK (source_type IN ('rate', 'payment', 'adjustment', 'occurrence'));

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
  v_closure record;
  v_visit record;
  v_rule teacher_pay_rules%ROWTYPE;
  v_rate record;
  v_month_rate record;
  v_revenue numeric;
  v_accrual numeric;
  v_percent numeric;
  v_schedule_group_id uuid;
  v_category text;
  v_fixed_pay_mode text;
  v_fixed_amount numeric;
BEGIN
  v_date_from := make_date(p_year, p_month, 1);
  v_date_to := (v_date_from + interval '1 month' - interval '1 day')::date;

  DELETE FROM teacher_settlement_line_items
  WHERE organization_id = p_org_id
    AND settlement_id = p_settlement_id;

  SELECT *
  INTO v_month_rate
  FROM payroll_rate_row_at_date(p_org_id, p_member_id, v_date_to);

  IF FOUND THEN
    v_fixed_pay_mode := v_month_rate.pay_mode;
    IF v_month_rate.pay_mode IN ('fixed', 'fixed_plus_percent')
      AND COALESCE(v_month_rate.fixed_amount, 0) > 0
    THEN
      v_fixed_amount := payroll_round_money(v_month_rate.fixed_amount);
      v_accrued := v_accrued + v_fixed_amount;

      INSERT INTO teacher_settlement_line_items (
        organization_id, settlement_id, member_id, line_category, source_type,
        line_date, monetary_base, pay_mode, fixed_rate_amount, percent_rate,
        accrual_amount, included_in_total, sort_at, computed_at
      ) VALUES (
        p_org_id, p_settlement_id, p_member_id, 'fixed', 'rate',
        v_date_from, 0, v_month_rate.pay_mode, v_fixed_amount, 0,
        v_fixed_amount, true, v_date_from::timestamptz, p_computed_at
      );
    END IF;
  END IF;

  IF COALESCE(v_fixed_pay_mode, 'percent') = 'fixed' THEN
    RETURN payroll_round_money(v_accrued);
  END IF;

  FOR v_closure IN
    SELECT
      c.id,
      c.occurrence_kind,
      c.occurrence_date,
      c.discipline_id,
      c.schedule_slot_id,
      c.teacher_member_id,
      c.source_personal_lesson_id,
      c.personal_lesson_id,
      pl.time_start AS personal_time_start,
      pl.time_end AS personal_time_end,
      pl.client_display AS personal_client_display,
      pl_d.name AS personal_discipline_name,
      pl_l.name AS personal_location_name,
      ss.time_start AS group_time_start,
      ss.time_end AS group_time_end,
      ss.class_id AS schedule_group_id,
      ss.group_name,
      gd.name AS group_discipline_name,
      gl.name AS group_location_name
    FROM lesson_occurrence_closures c
    LEFT JOIN personal_lessons pl
      ON pl.organization_id = c.organization_id
     AND pl.id = COALESCE(c.source_personal_lesson_id, c.personal_lesson_id)
    LEFT JOIN disciplines pl_d ON pl_d.id = c.discipline_id
    LEFT JOIN locations pl_l ON pl_l.id = c.location_id
    LEFT JOIN schedule_slots ss
      ON ss.organization_id = c.organization_id
     AND ss.id = c.schedule_slot_id
    LEFT JOIN disciplines gd ON gd.id = ss.discipline_id
    LEFT JOIN locations gl ON gl.id = ss.location_id
    WHERE c.organization_id = p_org_id
      AND c.status = 'closed'
      AND c.teacher_member_id = p_member_id
      AND c.occurrence_date BETWEEN v_date_from AND v_date_to
    ORDER BY c.occurrence_date, c.id
  LOOP
    v_category := v_closure.occurrence_kind;
    v_schedule_group_id := COALESCE(v_closure.schedule_group_id, (
      SELECT ss.class_id FROM schedule_slots ss
      WHERE ss.organization_id = p_org_id AND ss.id = v_closure.schedule_slot_id
    ));
    v_revenue := CASE v_closure.occurrence_kind
      WHEN 'personal' THEN COALESCE((
        SELECT pl.price
        FROM personal_lessons pl
        WHERE pl.organization_id = p_org_id
          AND pl.id = COALESCE(v_closure.source_personal_lesson_id, v_closure.personal_lesson_id)
      ), 0)
      ELSE group_occurrence_revenue(
        p_org_id,
        v_closure.schedule_slot_id,
        v_closure.occurrence_date
      )
    END;

    SELECT * INTO v_rule
    FROM resolve_teacher_pay_rule(
      p_org_id,
      p_member_id,
      v_category,
      v_closure.discipline_id,
      v_schedule_group_id,
      v_closure.occurrence_date
    );

    v_percent := 0;
    IF v_rule.id IS NULL THEN
      SELECT * INTO v_rate
      FROM payroll_rate_row_at_date(p_org_id, p_member_id, v_closure.occurrence_date);
      v_percent := CASE v_category
        WHEN 'personal' THEN COALESCE(v_rate.personal_rate_percent, 0)
        ELSE COALESCE(v_rate.group_rate_percent, 0)
      END;
    END IF;

    v_accrual := teacher_pay_teacher_accrual(v_revenue, v_rule, v_percent);
    IF v_accrual <= 0 THEN
      CONTINUE;
    END IF;

    v_accrued := v_accrued + v_accrual;

    INSERT INTO teacher_settlement_line_items (
      organization_id, settlement_id, member_id, line_category, source_type, source_id,
      line_date, time_start, time_end, title, discipline_name, location_name,
      monetary_base, pay_mode, fixed_rate_amount, percent_rate, accrual_amount,
      included_in_total, sort_at, computed_at
    ) VALUES (
      p_org_id, p_settlement_id, p_member_id, v_category, 'occurrence', v_closure.id,
      v_closure.occurrence_date,
      COALESCE(v_closure.personal_time_start, v_closure.group_time_start),
      COALESCE(v_closure.personal_time_end, v_closure.group_time_end),
      COALESCE(v_closure.group_name, v_closure.personal_client_display),
      COALESCE(v_closure.group_discipline_name, v_closure.personal_discipline_name),
      COALESCE(v_closure.group_location_name, v_closure.personal_location_name),
      payroll_round_money(v_revenue),
      COALESCE(v_rate.pay_mode, v_month_rate.pay_mode, 'percent'),
      0,
      CASE
        WHEN v_rule.id IS NOT NULL AND v_rule.amount_type = 'percent'
          THEN GREATEST(0, 100 - v_rule.value)
        ELSE v_percent
      END,
      v_accrual,
      true,
      v_closure.occurrence_date::timestamptz,
      p_computed_at
    );
  END LOOP;

  FOR v_visit IN
    SELECT
      sv.id,
      sv.visit_date,
      sv.amount,
      sv.client_display,
      sv.discipline_id,
      sv.schedule_group_id,
      sv.teacher_member_id,
      d.name AS discipline_name,
      l.name AS location_name,
      ss.time_start,
      ss.time_end,
      ss.group_name
    FROM single_visits sv
    LEFT JOIN schedule_slots ss
      ON ss.organization_id = sv.organization_id
     AND ss.id = sv.schedule_slot_id
    LEFT JOIN disciplines d ON d.id = sv.discipline_id
    LEFT JOIN locations l ON l.id = sv.location_id
    WHERE sv.organization_id = p_org_id
      AND sv.teacher_member_id = p_member_id
      AND sv.visit_date BETWEEN v_date_from AND v_date_to
    ORDER BY sv.visit_date, sv.id
  LOOP
    SELECT * INTO v_rule
    FROM resolve_teacher_pay_rule(
      p_org_id,
      p_member_id,
      'single_visit',
      v_visit.discipline_id,
      v_visit.schedule_group_id,
      v_visit.visit_date
    );

    v_percent := 0;
    IF v_rule.id IS NULL THEN
      SELECT * INTO v_rate
      FROM payroll_rate_row_at_date(p_org_id, p_member_id, v_visit.visit_date);
      v_percent := COALESCE(v_rate.single_visit_rate_percent, v_rate.group_rate_percent, 0);
    END IF;

    v_accrual := teacher_pay_teacher_accrual(v_visit.amount, v_rule, v_percent);
    IF v_accrual <= 0 THEN
      CONTINUE;
    END IF;

    v_accrued := v_accrued + v_accrual;

    INSERT INTO teacher_settlement_line_items (
      organization_id, settlement_id, member_id, line_category, source_type, source_id,
      line_date, time_start, time_end, title, discipline_name, location_name,
      monetary_base, pay_mode, fixed_rate_amount, percent_rate, accrual_amount,
      included_in_total, sort_at, computed_at
    ) VALUES (
      p_org_id, p_settlement_id, p_member_id, 'single_visit', 'occurrence', v_visit.id,
      v_visit.visit_date,
      v_visit.time_start,
      v_visit.time_end,
      COALESCE(v_visit.group_name, v_visit.client_display),
      v_visit.discipline_name,
      v_visit.location_name,
      payroll_round_money(v_visit.amount),
      COALESCE(v_rate.pay_mode, v_month_rate.pay_mode, 'percent'),
      0,
      CASE
        WHEN v_rule.id IS NOT NULL AND v_rule.amount_type = 'percent'
          THEN GREATEST(0, 100 - v_rule.value)
        ELSE v_percent
      END,
      v_accrual,
      true,
      v_visit.visit_date::timestamptz,
      p_computed_at
    );
  END LOOP;

  RETURN payroll_round_money(v_accrued);
END;
$$;

REVOKE ALL ON FUNCTION list_teacher_pay_rules(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_teacher_pay_rules(uuid) TO authenticated;

REVOKE ALL ON FUNCTION save_teacher_pay_rule(jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION save_teacher_pay_rule(jsonb, uuid) TO authenticated;

REVOKE ALL ON FUNCTION end_teacher_pay_rule_early(uuid, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION end_teacher_pay_rule_early(uuid, date, uuid) TO authenticated;

REVOKE ALL ON FUNCTION group_occurrence_revenue(uuid, uuid, date) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION post_teacher_pay_deduction_for_closure(uuid, uuid) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION post_teacher_pay_deduction_for_single_visit(uuid, uuid) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION post_venue_cost_for_closure_impl(uuid, uuid) FROM PUBLIC, authenticated;

REVOKE ALL ON FUNCTION record_single_visit(date, uuid, uuid, uuid, text, uuid, numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_single_visit(date, uuid, uuid, uuid, text, uuid, numeric, boolean) TO authenticated;

COMMIT;
