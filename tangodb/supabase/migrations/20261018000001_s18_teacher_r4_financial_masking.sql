-- S18 / H30, M54, M55, M57: teacher REST dump of billed_amount, payroll revenue lines,
-- own pay rules, and archived-price sales_count closed; narrow RPCs keep payment modals working.

BEGIN;

-- =============================================================================
-- 1. personal_lesson_charges: teacher uses RPC, not base-table SELECT (H30)
-- =============================================================================

CREATE OR REPLACE FUNCTION get_personal_lesson_charge_balances(p_lesson_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_financial boolean;
  v_charges jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  IF p_lesson_ids IS NULL OR cardinality(p_lesson_ids) = 0 THEN
    RETURN jsonb_build_object('success', true, 'charges', '[]'::jsonb);
  END IF;

  v_financial := can_read_financial() OR can_read_all_business();

  IF EXISTS (
    SELECT 1
    FROM unnest(p_lesson_ids) AS req(lesson_id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM personal_lessons pl
      WHERE pl.id = req.lesson_id
        AND pl.organization_id = v_org_id
        AND business_row_readable()
        AND (
          v_financial
          OR (
            current_member_role() = 'teacher'
            AND teacher_can_access_lesson(pl.id)
          )
        )
    )
  ) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  IF v_financial THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', plc.id,
          'personal_lesson_id', plc.personal_lesson_id,
          'client_id', plc.client_id,
          'billed_amount', plc.billed_amount,
          'paid_amount', COALESCE(personal_lesson_charge_net_payment(v_org_id, plc.id), 0),
          'remaining_amount', GREATEST(
            plc.billed_amount - COALESCE(personal_lesson_charge_net_payment(v_org_id, plc.id), 0),
            0
          )
        )
        ORDER BY plc.personal_lesson_id, plc.client_id
      ),
      '[]'::jsonb
    )
    INTO v_charges
    FROM personal_lesson_charges plc
    WHERE plc.organization_id = v_org_id
      AND plc.personal_lesson_id = ANY (p_lesson_ids);
  ELSE
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', plc.id,
          'personal_lesson_id', plc.personal_lesson_id,
          'client_id', plc.client_id,
          'remaining_amount', GREATEST(
            plc.billed_amount - COALESCE(personal_lesson_charge_net_payment(v_org_id, plc.id), 0),
            0
          )
        )
        ORDER BY plc.personal_lesson_id, plc.client_id
      ),
      '[]'::jsonb
    )
    INTO v_charges
    FROM personal_lesson_charges plc
    WHERE plc.organization_id = v_org_id
      AND plc.personal_lesson_id = ANY (p_lesson_ids);
  END IF;

  RETURN jsonb_build_object('success', true, 'charges', COALESCE(v_charges, '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION get_personal_lesson_charge_balances(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_personal_lesson_charge_balances(uuid[]) TO authenticated, service_role;

DROP POLICY IF EXISTS personal_lesson_charges_select_teacher ON personal_lesson_charges;

-- =============================================================================
-- 2. teacher_settlement_line_items: teacher reads only via masked RPC (M54)
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
  v_mask_financial boolean;
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

  v_mask_financial := NOT can_read_financial();

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', li.id,
      'lineCategory', li.line_category,
      'sourceType', li.source_type,
      'sourceId', li.source_id,
      'lineDate', li.line_date,
      'timeStart', li.time_start,
      'timeEnd', li.time_end,
      'title', CASE
        WHEN v_mask_financial THEN
          CASE
            WHEN li.line_date IS NOT NULL THEN 'занятие ' || to_char(li.line_date, 'DD.MM')
            ELSE 'занятие'
          END
        ELSE li.title
      END,
      'disciplineName', li.discipline_name,
      'locationName', li.location_name,
      'monetaryBase', CASE WHEN v_mask_financial THEN 0 ELSE li.monetary_base END,
      'payMode', li.pay_mode,
      'fixedRateAmount', CASE WHEN v_mask_financial THEN 0 ELSE li.fixed_rate_amount END,
      'percentRate', CASE WHEN v_mask_financial THEN 0 ELSE li.percent_rate END,
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
      'title', CASE
        WHEN v_mask_financial THEN
          CASE
            WHEN li.line_date IS NOT NULL THEN 'занятие ' || to_char(li.line_date, 'DD.MM')
            ELSE 'занятие'
          END
        ELSE li.title
      END,
      'disciplineName', li.discipline_name,
      'locationName', li.location_name,
      'monetaryBase', CASE WHEN v_mask_financial THEN 0 ELSE li.monetary_base END,
      'payMode', li.pay_mode,
      'fixedRateAmount', CASE WHEN v_mask_financial THEN 0 ELSE li.fixed_rate_amount END,
      'percentRate', CASE WHEN v_mask_financial THEN 0 ELSE li.percent_rate END,
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

DROP POLICY IF EXISTS teacher_settlement_line_items_select_own ON teacher_settlement_line_items;

-- =============================================================================
-- 3. teacher_pay_rules: SELECT only financial roles (M55)
-- =============================================================================

DROP POLICY IF EXISTS teacher_pay_rules_select ON teacher_pay_rules;

CREATE POLICY teacher_pay_rules_select ON teacher_pay_rules
  FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_financial()
  );

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

  IF NOT can_read_financial() THEN
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

REVOKE ALL ON FUNCTION list_teacher_pay_rules(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_teacher_pay_rules(uuid) TO authenticated, service_role;

-- =============================================================================
-- 4. list_archived_prices: sales_count only for manage/financial roles (M57)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.list_archived_prices()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_prices jsonb;
  v_show_sales boolean;
BEGIN
  IF v_org_id IS NULL OR NOT can_read_prices() THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  v_show_sales := can_manage_prices() OR can_read_financial();

  SELECT COALESCE(
    jsonb_agg(
      to_jsonb(p)
      || jsonb_build_object(
        'teacher_member_ids',
        COALESCE(
          (
            SELECT jsonb_agg(ptm.member_id ORDER BY ptm.member_id)
            FROM public.price_teacher_members ptm
            WHERE ptm.organization_id = v_org_id
              AND ptm.price_id = p.id
          ),
          '[]'::jsonb
        ),
        'discipline_ids',
        COALESCE(
          (
            SELECT jsonb_agg(pd.discipline_id ORDER BY pd.discipline_id)
            FROM public.price_disciplines pd
            WHERE pd.organization_id = v_org_id
              AND pd.price_id = p.id
          ),
          CASE
            WHEN p.discipline_id IS NULL THEN '[]'::jsonb
            ELSE jsonb_build_array(p.discipline_id)
          END
        ),
        'sales_count',
        CASE
          WHEN v_show_sales THEN
            (
              SELECT count(*)
              FROM public.subscriptions s
              WHERE s.organization_id = v_org_id
                AND s.price_id = p.id
            )
            +
            (
              SELECT count(*)
              FROM public.single_visits sv
              WHERE sv.organization_id = v_org_id
                AND sv.price_id = p.id
            )
          ELSE NULL
        END
      )
      ORDER BY p.archived_at DESC, p.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_prices
  FROM public.prices p
  WHERE p.organization_id = v_org_id
    AND p.status = 'archived';

  RETURN jsonb_build_object('success', true, 'prices', v_prices);
END;
$$;

REVOKE ALL ON FUNCTION public.list_archived_prices() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_archived_prices() TO authenticated, service_role;

COMMIT;
