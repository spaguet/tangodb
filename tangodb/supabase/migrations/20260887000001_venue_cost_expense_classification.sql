-- Venue cost rules: expense category + payee (landlord) for accountant classification.
-- Dashboard/finance view reads category/payee from accepted rule snapshot (default rent).

BEGIN;

-- Backfill before tightening validation (table CHECK uses venue_cost_rules_are_valid).
SELECT set_config('app.venue_cost_org_wide_migration', 'on', true);

UPDATE venue_cost_rule_versions
SET rules = COALESCE(rules, '{}'::jsonb)
  || jsonb_build_object('expense_category', 'rent')
WHERE mode <> 'disabled'
  AND NULLIF(rules ->> 'expense_category', '') IS NULL;

UPDATE venue_cost_rule_versions
SET rules = rules || jsonb_build_object('payee', '—')
WHERE mode <> 'disabled'
  AND length(btrim(COALESCE(rules ->> 'payee', ''))) = 0;

SELECT set_config('app.venue_cost_org_wide_migration', 'off', true);

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
  IF v_expense_category IS NOT NULL
    AND v_expense_category NOT IN ('rent', 'utilities', 'marketing', 'other')
  THEN
    RETURN false;
  END IF;

  -- Non-disabled rules must name the payee (landlord / counterparty).
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
  NULL::text AS payee,
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
  COALESCE(
    NULLIF(a.rule_snapshot -> 'rules' ->> 'expense_category', ''),
    'rent'
  )::text AS category,
  COALESCE(a.reason, a.accrual_kind) AS description,
  NULLIF(btrim(COALESCE(a.rule_snapshot -> 'rules' ->> 'payee', '')), '') AS payee,
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
  NULL::text AS payee,
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
    SELECT id, source_type, entry_date, amount, category, description, payee,
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

COMMIT;
