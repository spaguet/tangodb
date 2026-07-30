-- Teacher settlement line-item snapshots and detail RPC (CRM scenario 8 / Prompt 8)
-- Immutable calculation lines per settlement; per-payment historical rates; teacher self-service detail.

BEGIN;

-- =============================================================================
-- 1. Line items table
-- =============================================================================

CREATE TABLE teacher_settlement_line_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  settlement_id     UUID NOT NULL,
  member_id         UUID NOT NULL,
  line_category     TEXT NOT NULL
    CHECK (line_category IN ('fixed', 'group', 'personal', 'single_visit', 'adjustment')),
  source_type       TEXT NOT NULL
    CHECK (source_type IN ('rate', 'payment', 'adjustment')),
  source_id         UUID,
  line_date         DATE,
  time_start        TEXT,
  time_end          TEXT,
  title             TEXT,
  discipline_name   TEXT,
  location_name     TEXT,
  monetary_base     NUMERIC NOT NULL DEFAULT 0 CHECK (monetary_base >= 0),
  pay_mode          TEXT,
  fixed_rate_amount NUMERIC NOT NULL DEFAULT 0 CHECK (fixed_rate_amount >= 0),
  percent_rate      NUMERIC NOT NULL DEFAULT 0 CHECK (percent_rate >= 0),
  accrual_amount    NUMERIC NOT NULL DEFAULT 0 CHECK (accrual_amount >= 0),
  included_in_total BOOLEAN NOT NULL DEFAULT true,
  exclusion_reason  TEXT,
  sort_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  computed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, settlement_id)
    REFERENCES teacher_settlements (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_teacher_settlement_line_items_settlement
  ON teacher_settlement_line_items (organization_id, settlement_id, sort_at, id);

-- =============================================================================
-- 2. Helpers
-- =============================================================================

CREATE OR REPLACE FUNCTION payroll_rate_row_at_date(
  p_org_id uuid,
  p_member_id uuid,
  p_as_of date
)
RETURNS TABLE (
  pay_mode text,
  fixed_amount numeric,
  group_rate_percent numeric,
  personal_rate_percent numeric,
  single_visit_rate_percent numeric,
  effective_from date
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    COALESCE(tpr.pay_mode, 'percent'),
    COALESCE(tpr.fixed_amount, 0),
    COALESCE(tpr.group_rate_percent, 0),
    COALESCE(tpr.personal_rate_percent, 0),
    COALESCE(tpr.single_visit_rate_percent, COALESCE(tpr.group_rate_percent, 0), 0),
    tpr.effective_from
  FROM teacher_pay_rates tpr
  WHERE tpr.organization_id = p_org_id
    AND tpr.member_id = p_member_id
    AND tpr.effective_from <= p_as_of
  ORDER BY tpr.effective_from DESC, tpr.created_at DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION payroll_payment_category(
  p_personal_lesson_id uuid,
  p_subscription_id uuid,
  p_single_visit_id uuid
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_personal_lesson_id IS NOT NULL THEN 'personal'
    WHEN p_single_visit_id IS NOT NULL THEN 'single_visit'
    WHEN p_subscription_id IS NOT NULL THEN 'group'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION payroll_round_money(p_amount numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ROUND(COALESCE(p_amount, 0), 2);
$$;

CREATE OR REPLACE FUNCTION payroll_percent_accrual(
  p_base numeric,
  p_percent numeric
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT payroll_round_money(COALESCE(p_base, 0) * COALESCE(p_percent, 0) / 100.0);
$$;

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
        organization_id,
        settlement_id,
        member_id,
        line_category,
        source_type,
        line_date,
        title,
        monetary_base,
        pay_mode,
        fixed_rate_amount,
        percent_rate,
        accrual_amount,
        included_in_total,
        sort_at,
        computed_at
      ) VALUES (
        p_org_id,
        p_settlement_id,
        p_member_id,
        'fixed',
        'rate',
        v_date_from,
        NULL,
        0,
        v_month_rate.pay_mode,
        v_fixed_amount,
        0,
        v_fixed_amount,
        true,
        v_date_from::timestamptz,
        p_computed_at
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
      ON pl.organization_id = p.organization_id
     AND pl.id = p.personal_lesson_id
    LEFT JOIN disciplines pl_d ON pl_d.id = pl.discipline_id
    LEFT JOIN locations pl_l ON pl_l.id = pl.location_id
    LEFT JOIN single_visits sv
      ON sv.organization_id = p.organization_id
     AND sv.id = p.single_visit_id
    LEFT JOIN schedule_slots ss
      ON ss.organization_id = sv.organization_id
     AND ss.id = sv.schedule_slot_id
    LEFT JOIN disciplines sv_d ON sv_d.id = sv.discipline_id
    LEFT JOIN locations sv_l ON sv_l.id = sv.location_id
    LEFT JOIN disciplines ss_d ON ss_d.id = ss.discipline_id
    LEFT JOIN locations ss_l ON ss_l.id = ss.location_id
    LEFT JOIN LATERAL (
      SELECT
        c.name AS group_name,
        d.name AS discipline_name,
        l.name AS location_name
      FROM subscription_groups sg
      JOIN classes c
        ON c.organization_id = sg.organization_id
       AND c.id = sg.schedule_group_id
      LEFT JOIN disciplines d ON d.id = c.discipline_id
      LEFT JOIN locations l ON l.id = c.default_location_id
      WHERE sg.organization_id = p.organization_id
        AND sg.subscription_id = p.subscription_id
      ORDER BY sg.id
      LIMIT 1
    ) grp ON p.subscription_id IS NOT NULL
    WHERE p.organization_id = p_org_id
      AND p.created_at >= v_date_from
      AND p.created_at < (v_date_to + interval '1 day')
      AND payroll_resolve_payment_teacher_id(
        p_org_id,
        p.personal_lesson_id,
        p.subscription_id,
        p.single_visit_id
      ) = p_member_id
    ORDER BY p.created_at, p.id
  LOOP
    v_category := v_payment.category;
    IF v_category IS NULL THEN
      CONTINUE;
    END IF;

    SELECT *
    INTO v_rate
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
      v_line_accrual := payroll_percent_accrual(v_payment.amount, v_percent);
    END IF;

    IF v_line_accrual <= 0 THEN
      CONTINUE;
    END IF;

    v_accrued := v_accrued + v_line_accrual;

    INSERT INTO teacher_settlement_line_items (
      organization_id,
      settlement_id,
      member_id,
      line_category,
      source_type,
      source_id,
      line_date,
      time_start,
      time_end,
      title,
      discipline_name,
      location_name,
      monetary_base,
      pay_mode,
      fixed_rate_amount,
      percent_rate,
      accrual_amount,
      included_in_total,
      sort_at,
      computed_at
    ) VALUES (
      p_org_id,
      p_settlement_id,
      p_member_id,
      v_category,
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
      payroll_round_money(v_payment.amount),
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

-- =============================================================================
-- 3. Recalculate settlement (per-payment historical rates + line snapshots)
-- =============================================================================

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
  v_accrued numeric;
  v_existing_paid numeric;
  v_settlement_id uuid;
  v_computed_at timestamptz := now();
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
    SELECT ts.amount_paid, ts.id
    INTO v_existing_paid, v_settlement_id
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
      0,
      COALESCE(v_existing_paid, 0),
      v_computed_at
    )
    ON CONFLICT (organization_id, member_id, period_year, period_month)
    DO UPDATE SET
      computed_at = v_computed_at
    RETURNING id INTO v_settlement_id;

    v_accrued := payroll_refresh_settlement_lines(
      p_org_id,
      v_settlement_id,
      v_member.member_id,
      p_year,
      p_month,
      v_computed_at
    );

    UPDATE teacher_settlements
    SET amount_accrued = COALESCE(v_accrued, 0),
        computed_at = v_computed_at
    WHERE organization_id = p_org_id
      AND id = v_settlement_id;
  END LOOP;
END;
$$;

-- =============================================================================
-- 4. Detail RPC
-- =============================================================================

CREATE OR REPLACE FUNCTION get_teacher_settlement_detail(p_settlement_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_settlement teacher_settlements%ROWTYPE;
  v_lines jsonb;
  v_excluded jsonb;
  v_lines_total numeric;
  v_can_read boolean;
BEGIN
  SELECT *
  INTO v_settlement
  FROM teacher_settlements ts
  WHERE ts.id = p_settlement_id
    AND ts.organization_id = auth_organization_id()
    AND business_row_readable();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'settlement not found';
  END IF;

  v_can_read := can_read_financial()
    OR (
      current_member_role() = 'teacher'
      AND v_settlement.member_id = auth_member_id()
    );

  IF NOT v_can_read THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', li.id,
      'lineCategory', li.line_category,
      'sourceType', li.source_type,
      'sourceId', li.source_id,
      'lineDate', li.line_date,
      'timeStart', li.time_start,
      'timeEnd', li.time_end,
      'title', li.title,
      'disciplineName', li.discipline_name,
      'locationName', li.location_name,
      'monetaryBase', li.monetary_base,
      'payMode', li.pay_mode,
      'fixedRateAmount', li.fixed_rate_amount,
      'percentRate', li.percent_rate,
      'accrualAmount', li.accrual_amount,
      'includedInTotal', li.included_in_total,
      'exclusionReason', li.exclusion_reason,
      'sortAt', li.sort_at
    )
    ORDER BY li.sort_at, li.id
  ), '[]'::jsonb)
  INTO v_lines
  FROM teacher_settlement_line_items li
  WHERE li.organization_id = v_settlement.organization_id
    AND li.settlement_id = v_settlement.id
    AND li.included_in_total = true;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', li.id,
      'lineCategory', li.line_category,
      'sourceType', li.source_type,
      'sourceId', li.source_id,
      'lineDate', li.line_date,
      'timeStart', li.time_start,
      'timeEnd', li.time_end,
      'title', li.title,
      'disciplineName', li.discipline_name,
      'locationName', li.location_name,
      'monetaryBase', li.monetary_base,
      'payMode', li.pay_mode,
      'fixedRateAmount', li.fixed_rate_amount,
      'percentRate', li.percent_rate,
      'accrualAmount', li.accrual_amount,
      'includedInTotal', li.included_in_total,
      'exclusionReason', li.exclusion_reason,
      'sortAt', li.sort_at
    )
    ORDER BY li.sort_at, li.id
  ), '[]'::jsonb)
  INTO v_excluded
  FROM teacher_settlement_line_items li
  WHERE li.organization_id = v_settlement.organization_id
    AND li.settlement_id = v_settlement.id
    AND li.included_in_total = false;

  SELECT COALESCE(SUM(li.accrual_amount), 0)
  INTO v_lines_total
  FROM teacher_settlement_line_items li
  WHERE li.organization_id = v_settlement.organization_id
    AND li.settlement_id = v_settlement.id
    AND li.included_in_total = true;

  RETURN jsonb_build_object(
    'settlement', jsonb_build_object(
      'id', v_settlement.id,
      'memberId', v_settlement.member_id,
      'periodYear', v_settlement.period_year,
      'periodMonth', v_settlement.period_month,
      'amountAccrued', v_settlement.amount_accrued,
      'amountPaid', v_settlement.amount_paid,
      'computedAt', v_settlement.computed_at
    ),
    'lines', v_lines,
    'excludedLines', v_excluded,
    'reconciliation', jsonb_build_object(
      'linesTotal', payroll_round_money(v_lines_total),
      'amountAccrued', payroll_round_money(v_settlement.amount_accrued),
      'matches', payroll_round_money(v_lines_total) = payroll_round_money(v_settlement.amount_accrued),
      'computedAt', v_settlement.computed_at
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION get_teacher_settlement_detail(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_teacher_settlement_detail(uuid) TO authenticated;

-- =============================================================================
-- 5. RLS
-- =============================================================================

ALTER TABLE teacher_settlement_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY teacher_settlement_line_items_select_financial
  ON teacher_settlement_line_items FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_financial()
  );

CREATE POLICY teacher_settlement_line_items_select_own
  ON teacher_settlement_line_items FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND current_member_role() = 'teacher'
    AND member_id = auth_member_id()
  );

GRANT SELECT ON teacher_settlement_line_items TO authenticated;

COMMIT;
