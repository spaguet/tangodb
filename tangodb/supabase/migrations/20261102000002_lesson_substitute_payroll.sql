-- Payroll: pay the conducting teacher (substitute) for the occurrence.

BEGIN;

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
  v_sub record;
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
  v_occurrence_keys text[] := ARRAY[]::text[];
  v_occurrence_line_count integer := 0;
  v_net_amount numeric;
  v_occ_key text;
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
      ss.time AS group_time_start,
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
      AND c.occurrence_date BETWEEN v_date_from AND v_date_to
      AND occurrence_conducting_teacher_id(
        p_org_id,
        c.occurrence_kind,
        c.schedule_slot_id,
        COALESCE(c.source_personal_lesson_id, c.personal_lesson_id),
        c.occurrence_date,
        c.teacher_member_id
      ) = p_member_id
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
    v_occ_key := CASE
      WHEN v_closure.occurrence_kind = 'personal'
        THEN 'p:' || COALESCE(v_closure.source_personal_lesson_id, v_closure.personal_lesson_id)::text
      ELSE 'g:' || v_closure.schedule_slot_id::text || ':' || v_closure.occurrence_date::text
    END;
    v_occurrence_keys := array_append(v_occurrence_keys, v_occ_key);

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

  FOR v_sub IN
    SELECT
      s.id,
      s.occurrence_kind,
      s.occurrence_date,
      s.schedule_slot_id,
      s.personal_lesson_id,
      COALESCE(ss.discipline_id, pl.discipline_id) AS discipline_id,
      ss.class_id AS schedule_group_id,
      ss.time AS group_time_start,
      ss.time_end AS group_time_end,
      ss.group_name,
      gd.name AS group_discipline_name,
      gl.name AS group_location_name,
      pl.time_start AS personal_time_start,
      pl.time_end AS personal_time_end,
      pl.client_display AS personal_client_display,
      pl.price AS personal_price,
      pld.name AS personal_discipline_name,
      pll.name AS personal_location_name
    FROM lesson_occurrence_substitutes s
    LEFT JOIN schedule_slots ss
      ON ss.organization_id = s.organization_id
     AND ss.id = s.schedule_slot_id
    LEFT JOIN disciplines gd ON gd.id = ss.discipline_id
    LEFT JOIN locations gl ON gl.id = ss.location_id
    LEFT JOIN personal_lessons pl
      ON pl.organization_id = s.organization_id
     AND pl.id = s.personal_lesson_id
     AND pl.cancelled_at IS NULL
    LEFT JOIN disciplines pld ON pld.id = pl.discipline_id
    LEFT JOIN locations pll ON pll.id = pl.location_id
    WHERE s.organization_id = p_org_id
      AND s.substitute_teacher_member_id = p_member_id
      AND s.occurrence_date BETWEEN v_date_from AND v_date_to
      AND s.occurrence_date <= CURRENT_DATE
      AND (
        s.occurrence_kind <> 'group'
        OR NOT EXISTS (
          SELECT 1 FROM schedule_occurrence_cancellations soc
          WHERE soc.organization_id = s.organization_id
            AND soc.slot_id = s.schedule_slot_id
            AND soc.occurrence_date = s.occurrence_date
        )
      )
    ORDER BY s.occurrence_date, s.id
  LOOP
    v_occ_key := CASE
      WHEN v_sub.occurrence_kind = 'personal'
        THEN 'p:' || v_sub.personal_lesson_id::text
      ELSE 'g:' || v_sub.schedule_slot_id::text || ':' || v_sub.occurrence_date::text
    END;
    IF v_occ_key = ANY (v_occurrence_keys) THEN
      CONTINUE;
    END IF;

    v_category := v_sub.occurrence_kind;
    v_schedule_group_id := v_sub.schedule_group_id;
    v_revenue := CASE v_sub.occurrence_kind
      WHEN 'personal' THEN COALESCE(v_sub.personal_price, 0)
      ELSE group_occurrence_revenue(p_org_id, v_sub.schedule_slot_id, v_sub.occurrence_date)
    END;

    SELECT * INTO v_rule
    FROM resolve_teacher_pay_rule(
      p_org_id,
      p_member_id,
      v_category,
      v_sub.discipline_id,
      v_schedule_group_id,
      v_sub.occurrence_date
    );

    v_percent := 0;
    IF v_rule.id IS NULL THEN
      SELECT * INTO v_rate
      FROM payroll_rate_row_at_date(p_org_id, p_member_id, v_sub.occurrence_date);
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
    v_occurrence_source_ids := array_append(v_occurrence_source_ids, v_sub.id);
    v_occurrence_keys := array_append(v_occurrence_keys, v_occ_key);

    INSERT INTO teacher_settlement_line_items (
      organization_id, settlement_id, member_id, line_category, source_type, source_id,
      line_date, time_start, time_end, title, discipline_name, location_name,
      monetary_base, pay_mode, fixed_rate_amount, percent_rate, accrual_amount,
      included_in_total, sort_at, computed_at
    ) VALUES (
      p_org_id, p_settlement_id, p_member_id, v_category, 'occurrence', v_sub.id,
      v_sub.occurrence_date,
      COALESCE(v_sub.personal_time_start, v_sub.group_time_start),
      COALESCE(v_sub.personal_time_end, v_sub.group_time_end),
      COALESCE(v_sub.group_name, v_sub.personal_client_display),
      COALESCE(v_sub.group_discipline_name, v_sub.personal_discipline_name),
      COALESCE(v_sub.group_location_name, v_sub.personal_location_name),
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
      v_sub.occurrence_date::timestamptz,
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
      ss.time AS time_start,
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
        ss.time AS single_time_start,
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

COMMIT;
