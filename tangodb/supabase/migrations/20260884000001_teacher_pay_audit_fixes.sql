-- Audit fixes for teacher pay rules: dual accrual index, finance semantics,
-- revenue allocation, reopen/reclose, rule overlap/precedence, RPC hardening.

BEGIN;

-- =============================================================================
-- 1. Allow venue cost + teacher deduction on the same closure
-- =============================================================================

DROP INDEX IF EXISTS venue_cost_posted_lesson_unique;

CREATE UNIQUE INDEX venue_cost_posted_lesson_unique
  ON venue_cost_accruals (organization_id, closure_id)
  WHERE closure_id IS NOT NULL
    AND accrual_kind = 'lesson'
    AND accrual_status = 'posted'
    AND teacher_pay_rule_id IS NULL
    AND rule_version_id IS NOT NULL;

-- =============================================================================
-- 2. Rule overlap / resolution
-- =============================================================================

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
      AND r.discipline_id IS NOT DISTINCT FROM p_discipline_id
      AND r.schedule_group_id IS NOT DISTINCT FROM p_schedule_group_id
      AND (p_exclude_id IS NULL OR r.id <> p_exclude_id)
      AND daterange(r.valid_from, COALESCE(r.valid_to, 'infinity'::date), '[]')
          && daterange(p_valid_from, COALESCE(p_valid_to, 'infinity'::date), '[]')
      AND (
        r.lesson_kind = p_lesson_kind
        OR r.lesson_kind = 'all'
        OR p_lesson_kind = 'all'
      )
  );
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
    CASE WHEN r.lesson_kind = p_lesson_kind THEN 0 ELSE 1 END,
    teacher_pay_rule_specificity(r.discipline_id, r.schedule_group_id) DESC,
    CASE WHEN r.schedule_group_id IS NULL THEN 1 ELSE 0 END,
    CASE WHEN r.discipline_id IS NULL THEN 1 ELSE 0 END,
    r.valid_from DESC,
    r.created_at DESC
  LIMIT 1;
$$;

-- =============================================================================
-- 3. Group revenue: historical sale price + slot/group pool split
-- =============================================================================

CREATE OR REPLACE FUNCTION group_occurrence_revenue(
  p_org_id uuid,
  p_schedule_slot_id uuid,
  p_occurrence_date date
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_class_id uuid;
  v_pool numeric := 0;
  v_share_count numeric := 1;
BEGIN
  SELECT ss.class_id INTO v_class_id
  FROM schedule_slots ss
  WHERE ss.organization_id = p_org_id
    AND ss.id = p_schedule_slot_id;

  IF v_class_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(sum(
    CASE
      WHEN s.billing_model = 'lesson_count'
        AND s.lessons_total > 0
      THEN subscription_sale_price(s.organization_id, s.id) / s.lessons_total
      ELSE 0
    END
  ), 0)
  INTO v_pool
  FROM attendance a
  JOIN subscriptions s
    ON s.organization_id = a.organization_id
   AND s.id = a.subscription_id
  WHERE a.organization_id = p_org_id
    AND a.schedule_group_id = v_class_id
    AND a.date = p_occurrence_date
    AND a.attendance_status = 'present';

  SELECT GREATEST(count(*), 1)::numeric INTO v_share_count
  FROM lesson_occurrence_closures loc
  JOIN schedule_slots ss
    ON ss.organization_id = loc.organization_id
   AND ss.id = loc.schedule_slot_id
  WHERE loc.organization_id = p_org_id
    AND loc.status = 'closed'
    AND loc.occurrence_kind = 'group'
    AND loc.occurrence_date = p_occurrence_date
    AND ss.class_id = v_class_id;

  RETURN payroll_round_money(v_pool / v_share_count);
END;
$$;

-- =============================================================================
-- 4. Finance view: studio share is not an expense; categorized deductions only
-- =============================================================================

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
  'venue'::text AS category,
  COALESCE(a.reason, a.accrual_kind) AS description,
  a.rule_version_id,
  a.closure_id,
  NULL::uuid AS teacher_pay_rule_id,
  a.created_at
FROM venue_cost_accruals a
WHERE a.accrual_status = 'posted'
  AND a.teacher_pay_rule_id IS NULL
UNION ALL
SELECT
  a.organization_id,
  a.id,
  'teacher_expense'::text AS source_type,
  a.accrual_date AS entry_date,
  a.amount,
  tpr.expense_category::text AS category,
  COALESCE(a.reason, 'teacher_pay_deduction') AS description,
  NULL::uuid AS rule_version_id,
  a.closure_id,
  a.teacher_pay_rule_id,
  a.created_at
FROM venue_cost_accruals a
JOIN teacher_pay_rules tpr
  ON tpr.organization_id = a.organization_id
 AND tpr.id = a.teacher_pay_rule_id
WHERE a.accrual_status = 'posted'
  AND a.teacher_pay_rule_id IS NOT NULL
  AND tpr.expense_category IS NOT NULL;

REVOKE ALL ON finance_cost_entries_v FROM PUBLIC, anon;
GRANT SELECT ON finance_cost_entries_v TO authenticated;

CREATE OR REPLACE FUNCTION get_finance_costs(
  p_date_from date,
  p_date_to date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_entries jsonb;
  v_summary jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL OR NOT can_read_financial() THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;
  IF p_date_from IS NULL OR p_date_to IS NULL OR p_date_to < p_date_from THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_period');
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.entry_date DESC, x.created_at DESC), '[]'::jsonb)
  INTO v_entries
  FROM (
    SELECT id, source_type, entry_date, amount, category, description,
           rule_version_id, closure_id, teacher_pay_rule_id, created_at
    FROM finance_cost_entries_v
    WHERE organization_id = v_org_id AND entry_date BETWEEN p_date_from AND p_date_to
  ) x;

  SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.month), '[]'::jsonb)
  INTO v_summary
  FROM (
    SELECT
      to_char(date_trunc('month', entry_date), 'YYYY-MM') AS month,
      COALESCE(sum(amount) FILTER (WHERE source_type = 'manual_expense'), 0)::numeric(14,2) AS manual_total,
      COALESCE(sum(amount) FILTER (WHERE source_type = 'venue_cost'), 0)::numeric(14,2) AS venue_total,
      COALESCE(sum(amount) FILTER (WHERE source_type = 'teacher_expense'), 0)::numeric(14,2) AS teacher_expense_total,
      COALESCE(sum(amount), 0)::numeric(14,2) AS total
    FROM finance_cost_entries_v
    WHERE organization_id = v_org_id AND entry_date BETWEEN p_date_from AND p_date_to
    GROUP BY date_trunc('month', entry_date)
  ) m;

  RETURN jsonb_build_object(
    'success', true,
    'entries', v_entries,
    'monthly_summary', v_summary,
    'manual_total', COALESCE((
      SELECT sum(amount) FROM finance_cost_entries_v
      WHERE organization_id = v_org_id AND source_type = 'manual_expense'
        AND entry_date BETWEEN p_date_from AND p_date_to
    ), 0),
    'venue_total', COALESCE((
      SELECT sum(amount) FROM finance_cost_entries_v
      WHERE organization_id = v_org_id AND source_type = 'venue_cost'
        AND entry_date BETWEEN p_date_from AND p_date_to
    ), 0),
    'teacher_expense_total', COALESCE((
      SELECT sum(amount) FROM finance_cost_entries_v
      WHERE organization_id = v_org_id AND source_type = 'teacher_expense'
        AND entry_date BETWEEN p_date_from AND p_date_to
    ), 0),
    'total', COALESCE((
      SELECT sum(amount) FROM finance_cost_entries_v
      WHERE organization_id = v_org_id AND entry_date BETWEEN p_date_from AND p_date_to
    ), 0)
  );
END;
$$;

-- =============================================================================
-- 5. Reopen must reverse all posted lesson accruals (venue + teacher)
-- =============================================================================

CREATE OR REPLACE FUNCTION reopen_lesson_occurrence_closure(
  p_closure_id uuid,
  p_reason text,
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
  v_closure lesson_occurrence_closures%ROWTYPE;
  v_accrual venue_cost_accruals%ROWTYPE;
  v_adjustment_ids uuid[] := ARRAY[]::uuid[];
  v_adjustment_id uuid;
  v_result jsonb;
  v_fingerprint text := md5(concat_ws('|', p_closure_id, p_reason));
  v_cached jsonb;
BEGIN
  v_cached := check_operation_idempotency(v_org_id, 'reopen_lesson_occurrence_closure', p_idempotency_key, v_fingerprint);
  IF v_cached IS NOT NULL THEN RETURN v_cached || jsonb_build_object('already_applied', true); END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL OR NOT can_read_financial()
    OR NOT organization_allows_writes(v_org_id)
  THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'reason_required');
  END IF;

  SELECT * INTO v_closure FROM lesson_occurrence_closures
  WHERE id = p_closure_id AND organization_id = v_org_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'closure_not_found');
  END IF;
  IF v_closure.status = 'reopened' THEN
    RETURN jsonb_build_object('success', true, 'closure_id', v_closure.id, 'already_applied', true);
  END IF;

  FOR v_accrual IN
    SELECT *
    FROM venue_cost_accruals a
    WHERE a.organization_id = v_org_id
      AND a.closure_id = v_closure.id
      AND a.accrual_status = 'posted'
      AND a.accrual_kind = 'lesson'
      AND a.amount <> 0
      AND NOT EXISTS (
        SELECT 1 FROM venue_cost_accruals adj
        WHERE adj.organization_id = a.organization_id
          AND adj.adjusts_accrual_id = a.id
          AND adj.accrual_status = 'posted'
      )
    ORDER BY a.created_at
  LOOP
    INSERT INTO venue_cost_accruals (
      organization_id, rule_version_id, teacher_pay_rule_id, closure_id,
      accrual_kind, accrual_status, accrual_date, amount, currency,
      adjusts_accrual_id, rule_snapshot, source_snapshot, reason, created_by
    ) VALUES (
      v_org_id, v_accrual.rule_version_id, v_accrual.teacher_pay_rule_id, v_closure.id,
      'adjustment', 'posted', v_accrual.accrual_date, -v_accrual.amount, v_accrual.currency,
      v_accrual.id, v_accrual.rule_snapshot, v_accrual.source_snapshot, trim(p_reason), v_member_id
    )
    RETURNING id INTO v_adjustment_id;
    v_adjustment_ids := array_append(v_adjustment_ids, v_adjustment_id);
  END LOOP;

  IF cardinality(v_adjustment_ids) = 0 THEN
    UPDATE venue_cost_accruals
    SET accrual_status = 'void', amount = COALESCE(amount, 0), reason = trim(p_reason)
    WHERE organization_id = v_org_id AND closure_id = v_closure.id
      AND accrual_status = 'pending_unpriced';
  END IF;

  UPDATE lesson_occurrence_closures
  SET status = 'reopened', pricing_status = 'reversed', reopened_by = v_member_id,
      reopened_at = now(), reopen_reason = trim(p_reason)
  WHERE id = v_closure.id;

  v_result := jsonb_build_object(
    'success', true,
    'closure_id', v_closure.id,
    'adjustment_ids', to_jsonb(v_adjustment_ids)
  );
  PERFORM store_operation_idempotency(v_org_id, 'reopen_lesson_occurrence_closure', p_idempotency_key, v_fingerprint, v_result);
  RETURN v_result;
END;
$$;

-- =============================================================================
-- 6. Closure posting returns teacher deduction diagnostics
-- =============================================================================

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
  v_teacher_result jsonb;
BEGIN
  v_result := post_venue_cost_for_closure_impl(p_closure_id, p_actor_id);
  v_teacher_result := post_teacher_pay_deduction_for_closure(p_closure_id, p_actor_id);
  RETURN v_result || jsonb_build_object('teacher_deduction', v_teacher_result);
END;
$$;

-- =============================================================================
-- 7. Teacher pay rule RPC hardening
-- =============================================================================

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
  v_existing teacher_pay_rules%ROWTYPE;
BEGIN
  v_cached := check_operation_idempotency(v_org_id, 'save_teacher_pay_rule', p_idempotency_key, v_fingerprint);
  IF v_cached IS NOT NULL THEN
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL OR current_member_role() NOT IN ('owner', 'director')
    OR NOT organization_allows_writes(v_org_id)
  THEN
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

  IF v_schedule_group_id IS NOT NULL AND v_discipline_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM classes c
    WHERE c.organization_id = v_org_id
      AND c.id = v_schedule_group_id
      AND c.discipline_id = v_discipline_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_schedule_group');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_org_id::text || ':teacher-pay-rules', 0));

  IF v_rule_id IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM teacher_pay_rules
    WHERE id = v_rule_id AND organization_id = v_org_id AND member_id = v_teacher_member_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'rule_not_found');
    END IF;

    IF v_existing.valid_from <= current_date THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'active_rule_not_editable');
    END IF;

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

  IF auth.uid() IS NULL OR v_org_id IS NULL OR current_member_role() NOT IN ('owner', 'director')
    OR NOT organization_allows_writes(v_org_id)
  THEN
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
-- 8. Payroll: occurrence-first with payment fallback for uncovered payments
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
  v_closure record;
  v_visit record;
  v_payment record;
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
  v_occurrence_source_ids uuid[] := ARRAY[]::uuid[];
  v_occurrence_line_count integer := 0;
  v_net_amount numeric;
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
    v_occurrence_line_count := v_occurrence_line_count + 1;
    v_occurrence_source_ids := array_append(v_occurrence_source_ids, v_closure.id);

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
    v_occurrence_line_count := v_occurrence_line_count + 1;
    v_occurrence_source_ids := array_append(v_occurrence_source_ids, v_visit.id);

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

  IF v_occurrence_line_count = 0 THEN
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
        COALESCE(
          v_payment.personal_date,
          v_payment.single_visit_date,
          (v_payment.created_at AT TIME ZONE 'UTC')::date
        )
      );

      IF NOT FOUND OR COALESCE(v_rate.pay_mode, 'percent') = 'fixed' THEN
        v_accrual := 0;
        v_percent := 0;
      ELSE
        v_percent := CASE v_category
          WHEN 'personal' THEN COALESCE(v_rate.personal_rate_percent, 0)
          WHEN 'single_visit' THEN COALESCE(v_rate.single_visit_rate_percent, 0)
          ELSE COALESCE(v_rate.group_rate_percent, 0)
        END;
        v_accrual := payroll_percent_accrual(v_net_amount, v_percent);
      END IF;

      IF v_accrual = 0 THEN
        CONTINUE;
      END IF;

      v_accrued := v_accrued + v_accrual;

      INSERT INTO teacher_settlement_line_items (
        organization_id, settlement_id, member_id, line_category, source_type, source_id,
        line_date, time_start, time_end, title, discipline_name, location_name,
        monetary_base, pay_mode, fixed_rate_amount, percent_rate, accrual_amount,
        included_in_total, sort_at, computed_at
      ) VALUES (
        p_org_id, p_settlement_id, p_member_id,
        CASE WHEN v_net_amount < 0 THEN 'adjustment' ELSE v_category END,
        'payment', v_payment.id,
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
        COALESCE(v_rate.pay_mode, v_month_rate.pay_mode, 'percent'),
        0,
        v_percent,
        v_accrual,
        true,
        COALESCE(
          v_payment.personal_date,
          v_payment.single_visit_date,
          (v_payment.created_at AT TIME ZONE 'UTC')::date
        )::timestamptz,
        p_computed_at
      );
    END LOOP;
  END IF;

  RETURN payroll_round_money(v_accrued);
END;
$$;

REVOKE ALL ON FUNCTION get_finance_costs(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_finance_costs(date, date) TO authenticated;

COMMIT;
