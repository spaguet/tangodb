-- Finance costs: human-readable labels for venue/teacher accruals (lesson context, not raw accrual_kind).

BEGIN;

CREATE OR REPLACE FUNCTION personal_lesson_client_label(
  p_client_id1 uuid,
  p_client_id2 uuid,
  p_client_id3 uuid,
  p_client_id4 uuid,
  p_c1_last text,
  p_c1_first text,
  p_c2_last text,
  p_c2_first text,
  p_c3_last text,
  p_c3_first text,
  p_c4_last text,
  p_c4_first text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT NULLIF(
    TRIM(BOTH ' &' FROM CONCAT_WS(
      ' & ',
      CASE WHEN p_client_id1 IS NOT NULL THEN TRIM(COALESCE(p_c1_last, '') || ' ' || COALESCE(p_c1_first, '')) END,
      CASE WHEN p_client_id2 IS NOT NULL THEN TRIM(COALESCE(p_c2_last, '') || ' ' || COALESCE(p_c2_first, '')) END,
      CASE WHEN p_client_id3 IS NOT NULL THEN TRIM(COALESCE(p_c3_last, '') || ' ' || COALESCE(p_c3_first, '')) END,
      CASE WHEN p_client_id4 IS NOT NULL THEN TRIM(COALESCE(p_c4_last, '') || ' ' || COALESCE(p_c4_first, '')) END
    )),
    ''
  );
$$;

CREATE OR REPLACE FUNCTION format_finance_cost_description(
  p_detail_kind text,
  p_reason text,
  p_title text,
  p_discipline_name text,
  p_location_name text,
  p_time_start text,
  p_time_end text,
  p_attendee_count integer,
  p_period_from date,
  p_period_to date
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_detail_kind = 'venue_adjustment' AND NULLIF(btrim(p_reason), '') IS NOT NULL THEN
      btrim(p_reason)
  WHEN p_detail_kind = 'venue_fixed_period' THEN
      TRIM(BOTH ' · ' FROM CONCAT_WS(
        ' · ',
        'Фиксированная аренда зала',
        NULLIF(btrim(p_location_name), ''),
        CASE
          WHEN p_period_from IS NOT NULL AND p_period_to IS NOT NULL THEN
            to_char(p_period_from, 'DD.MM') || '–' || to_char(p_period_to, 'DD.MM.YYYY')
          ELSE NULL
        END
      ))
    WHEN p_detail_kind = 'venue_lesson_personal' THEN
      TRIM(BOTH ' · ' FROM CONCAT_WS(
        ' · ',
        'Персональный урок',
        NULLIF(btrim(p_title), ''),
        NULLIF(btrim(p_discipline_name), ''),
        CASE
          WHEN NULLIF(btrim(p_time_start), '') IS NOT NULL THEN
            btrim(p_time_start)
            || CASE
              WHEN NULLIF(btrim(p_time_end), '') IS NOT NULL THEN '–' || btrim(p_time_end)
              ELSE ''
            END
          ELSE NULL
        END,
        NULLIF(btrim(p_location_name), '')
      ))
    WHEN p_detail_kind = 'venue_lesson_group' THEN
      TRIM(BOTH ' · ' FROM CONCAT_WS(
        ' · ',
        'Групповое занятие',
        COALESCE(NULLIF(btrim(p_title), ''), NULLIF(btrim(p_discipline_name), ''), 'Группа'),
        CASE
          WHEN NULLIF(btrim(p_time_start), '') IS NOT NULL THEN
            btrim(p_time_start)
            || CASE
              WHEN NULLIF(btrim(p_time_end), '') IS NOT NULL THEN '–' || btrim(p_time_end)
              ELSE ''
            END
          ELSE NULL
        END,
        CASE
          WHEN p_attendee_count IS NOT NULL THEN p_attendee_count::text || ' чел.'
          ELSE NULL
        END,
        NULLIF(btrim(p_location_name), '')
      ))
    WHEN p_detail_kind = 'teacher_deduction' THEN
      TRIM(BOTH ' · ' FROM CONCAT_WS(
        ' · ',
        'Удержание по правилу оплаты',
        NULLIF(btrim(p_title), ''),
        NULLIF(btrim(p_discipline_name), ''),
        CASE
          WHEN NULLIF(btrim(p_time_start), '') IS NOT NULL THEN
            btrim(p_time_start)
            || CASE
              WHEN NULLIF(btrim(p_time_end), '') IS NOT NULL THEN '–' || btrim(p_time_end)
              ELSE ''
            END
          ELSE NULL
        END,
        NULLIF(btrim(p_location_name), '')
      ))
    WHEN NULLIF(btrim(p_reason), '') IS NOT NULL THEN btrim(p_reason)
    ELSE COALESCE(NULLIF(btrim(p_title), ''), 'Затраты на зал')
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
  COALESCE(NULLIF(btrim(e.description), ''), e.category) AS description,
  NULLIF(btrim(e.payee), '') AS payee,
  NULL::uuid AS rule_version_id,
  NULL::uuid AS closure_id,
  NULL::uuid AS teacher_pay_rule_id,
  'manual'::text AS detail_kind,
  NULL::text AS title,
  NULL::text AS discipline_name,
  NULL::text AS location_name,
  NULL::text AS time_start,
  NULL::text AS time_end,
  NULL::integer AS attendee_count,
  NULL::date AS period_from,
  NULL::date AS period_to,
  NULL::text AS reason,
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
  format_finance_cost_description(
    CASE
      WHEN a.accrual_kind = 'fixed_period' THEN 'venue_fixed_period'
      WHEN a.accrual_kind = 'adjustment' THEN 'venue_adjustment'
      WHEN c.occurrence_kind = 'personal' THEN 'venue_lesson_personal'
      WHEN c.occurrence_kind = 'group' THEN 'venue_lesson_group'
      ELSE 'venue_adjustment'
    END,
    a.reason,
    CASE
      WHEN c.occurrence_kind = 'group' THEN NULLIF(btrim(ss.group_name), '')
      WHEN c.occurrence_kind = 'personal' THEN personal_lesson_client_label(
        pl.client_id1, pl.client_id2, pl.client_id3, pl.client_id4,
        c1.last_name, c1.first_name,
        c2.last_name, c2.first_name,
        c3.last_name, c3.first_name,
        c4.last_name, c4.first_name
      )
      ELSE NULL
    END,
    COALESCE(pl_d.name, gd.name, d.name),
    COALESCE(pl_l.name, gl.name, al.name, loc_a.name),
    COALESCE(pl.time_start, ss.time),
    COALESCE(pl.time_end, ss.time_end),
    c.confirmed_attendee_count,
    a.period_from,
    a.period_to
  ) AS description,
  NULLIF(btrim(COALESCE(a.rule_snapshot -> 'rules' ->> 'payee', '')), '') AS payee,
  a.rule_version_id,
  a.closure_id,
  NULL::uuid AS teacher_pay_rule_id,
  CASE
    WHEN a.accrual_kind = 'fixed_period' THEN 'venue_fixed_period'
    WHEN a.accrual_kind = 'adjustment' THEN 'venue_adjustment'
    WHEN c.occurrence_kind = 'personal' THEN 'venue_lesson_personal'
    WHEN c.occurrence_kind = 'group' THEN 'venue_lesson_group'
    ELSE 'venue_adjustment'
  END AS detail_kind,
  CASE
    WHEN c.occurrence_kind = 'group' THEN NULLIF(btrim(ss.group_name), '')
    WHEN c.occurrence_kind = 'personal' THEN personal_lesson_client_label(
      pl.client_id1, pl.client_id2, pl.client_id3, pl.client_id4,
      c1.last_name, c1.first_name,
      c2.last_name, c2.first_name,
      c3.last_name, c3.first_name,
      c4.last_name, c4.first_name
    )
    ELSE NULL
  END AS title,
  COALESCE(pl_d.name, gd.name, d.name) AS discipline_name,
  COALESCE(pl_l.name, gl.name, al.name, loc_a.name) AS location_name,
  COALESCE(pl.time_start, ss.time) AS time_start,
  COALESCE(pl.time_end, ss.time_end) AS time_end,
  c.confirmed_attendee_count AS attendee_count,
  a.period_from,
  a.period_to,
  a.reason,
  a.created_at
FROM venue_cost_accruals a
LEFT JOIN lesson_occurrence_closures c
  ON c.organization_id = a.organization_id
 AND c.id = a.closure_id
LEFT JOIN personal_lessons pl
  ON pl.organization_id = a.organization_id
 AND pl.id = COALESCE(c.source_personal_lesson_id, c.personal_lesson_id)
LEFT JOIN clients c1
  ON c1.organization_id = pl.organization_id AND c1.id = pl.client_id1
LEFT JOIN clients c2
  ON c2.organization_id = pl.organization_id AND c2.id = pl.client_id2
LEFT JOIN clients c3
  ON c3.organization_id = pl.organization_id AND c3.id = pl.client_id3
LEFT JOIN clients c4
  ON c4.organization_id = pl.organization_id AND c4.id = pl.client_id4
LEFT JOIN disciplines pl_d
  ON pl_d.organization_id = a.organization_id AND pl_d.id = pl.discipline_id
LEFT JOIN locations pl_l
  ON pl_l.organization_id = a.organization_id AND pl_l.id = pl.location_id
LEFT JOIN schedule_slots ss
  ON ss.organization_id = a.organization_id AND ss.id = c.schedule_slot_id
LEFT JOIN disciplines gd
  ON gd.organization_id = a.organization_id AND gd.id = ss.discipline_id
LEFT JOIN locations gl
  ON gl.organization_id = a.organization_id AND gl.id = ss.location_id
LEFT JOIN disciplines d
  ON d.organization_id = a.organization_id AND d.id = c.discipline_id
LEFT JOIN locations al
  ON al.organization_id = a.organization_id AND al.id = c.location_id
LEFT JOIN locations loc_a
  ON loc_a.organization_id = a.organization_id AND loc_a.id = a.location_id
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
  format_finance_cost_description(
    'teacher_deduction',
    a.reason,
    CASE
      WHEN c.occurrence_kind = 'group' THEN NULLIF(btrim(ss.group_name), '')
      WHEN c.occurrence_kind = 'personal' THEN personal_lesson_client_label(
        pl.client_id1, pl.client_id2, pl.client_id3, pl.client_id4,
        c1.last_name, c1.first_name,
        c2.last_name, c2.first_name,
        c3.last_name, c3.first_name,
        c4.last_name, c4.first_name
      )
      ELSE NULL
    END,
    COALESCE(pl_d.name, gd.name, d.name),
    COALESCE(pl_l.name, gl.name, al.name),
    COALESCE(pl.time_start, ss.time),
    COALESCE(pl.time_end, ss.time_end),
    c.confirmed_attendee_count,
    NULL::date,
    NULL::date
  ) AS description,
  NULL::text AS payee,
  NULL::uuid AS rule_version_id,
  a.closure_id,
  a.teacher_pay_rule_id,
  'teacher_deduction'::text AS detail_kind,
  CASE
    WHEN c.occurrence_kind = 'group' THEN NULLIF(btrim(ss.group_name), '')
    WHEN c.occurrence_kind = 'personal' THEN personal_lesson_client_label(
      pl.client_id1, pl.client_id2, pl.client_id3, pl.client_id4,
      c1.last_name, c1.first_name,
      c2.last_name, c2.first_name,
      c3.last_name, c3.first_name,
      c4.last_name, c4.first_name
    )
    ELSE NULL
  END AS title,
  COALESCE(pl_d.name, gd.name, d.name) AS discipline_name,
  COALESCE(pl_l.name, gl.name, al.name) AS location_name,
  COALESCE(pl.time_start, ss.time) AS time_start,
  COALESCE(pl.time_end, ss.time_end) AS time_end,
  c.confirmed_attendee_count AS attendee_count,
  NULL::date AS period_from,
  NULL::date AS period_to,
  a.reason,
  a.created_at
FROM venue_cost_accruals a
JOIN teacher_pay_rules tpr
  ON tpr.organization_id = a.organization_id
 AND tpr.id = a.teacher_pay_rule_id
LEFT JOIN lesson_occurrence_closures c
  ON c.organization_id = a.organization_id
 AND c.id = a.closure_id
LEFT JOIN personal_lessons pl
  ON pl.organization_id = a.organization_id
 AND pl.id = COALESCE(c.source_personal_lesson_id, c.personal_lesson_id)
LEFT JOIN clients c1
  ON c1.organization_id = pl.organization_id AND c1.id = pl.client_id1
LEFT JOIN clients c2
  ON c2.organization_id = pl.organization_id AND c2.id = pl.client_id2
LEFT JOIN clients c3
  ON c3.organization_id = pl.organization_id AND c3.id = pl.client_id3
LEFT JOIN clients c4
  ON c4.organization_id = pl.organization_id AND c4.id = pl.client_id4
LEFT JOIN disciplines pl_d
  ON pl_d.organization_id = a.organization_id AND pl_d.id = pl.discipline_id
LEFT JOIN locations pl_l
  ON pl_l.organization_id = a.organization_id AND pl_l.id = pl.location_id
LEFT JOIN schedule_slots ss
  ON ss.organization_id = a.organization_id AND ss.id = c.schedule_slot_id
LEFT JOIN disciplines gd
  ON gd.organization_id = a.organization_id AND gd.id = ss.discipline_id
LEFT JOIN locations gl
  ON gl.organization_id = a.organization_id AND gl.id = ss.location_id
LEFT JOIN disciplines d
  ON d.organization_id = a.organization_id AND d.id = c.discipline_id
LEFT JOIN locations al
  ON al.organization_id = a.organization_id AND al.id = c.location_id
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
    SELECT
      id,
      source_type,
      entry_date,
      amount,
      category,
      description,
      payee,
      rule_version_id,
      closure_id,
      teacher_pay_rule_id,
      detail_kind,
      title,
      discipline_name,
      location_name,
      time_start,
      time_end,
      attendee_count,
      period_from,
      period_to,
      reason,
      created_at
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
