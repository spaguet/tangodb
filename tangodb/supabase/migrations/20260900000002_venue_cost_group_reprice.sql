-- Reprice lesson accruals that were posted as 0 before group rules existed.
-- Human-readable labels for adjustment reason codes in finance costs.

BEGIN;

CREATE OR REPLACE FUNCTION venue_cost_accrual_reason_label(p_reason text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_reason = 'correction_after_rule_accept' THEN
      'Пересчёт аренды после принятия правила'
    WHEN p_reason LIKE 'corrected_zero_accrual:%' THEN
      'Пересчёт нулевого начисления аренды'
    WHEN p_reason LIKE 'resolved_by_rule:%' THEN
      'Заменено правилом аренды'
    ELSE NULLIF(btrim(p_reason), '')
  END;
$$;

CREATE OR REPLACE FUNCTION venue_cost_reprice_zero_lesson_accrual(
  p_org_id uuid,
  p_closure_id uuid,
  p_accrual_id uuid,
  p_actor_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_closure lesson_occurrence_closures%ROWTYPE;
  v_match record;
  v_rule venue_cost_rule_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_closure
  FROM lesson_occurrence_closures
  WHERE id = p_closure_id
    AND organization_id = p_org_id
    AND status = 'closed';

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT * INTO v_match
  FROM venue_cost_find_best_per_lesson_match(
    v_closure.organization_id,
    v_closure.occurrence_date,
    v_closure.occurrence_kind,
    v_closure.discipline_id,
    v_closure.location_id,
    v_closure.confirmed_attendee_count,
    v_closure.teacher_member_id
  );

  IF NOT COALESCE(v_match.matched, false) OR COALESCE(v_match.amount, 0) <= 0 THEN
    RETURN false;
  END IF;

  SELECT * INTO v_rule
  FROM venue_cost_rule_versions
  WHERE id = v_match.rule_version_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE venue_cost_accruals
  SET accrual_status = 'void',
      amount = 0,
      reason = 'corrected_zero_accrual:' || v_rule.id::text
  WHERE id = p_accrual_id
    AND organization_id = p_org_id
    AND accrual_status = 'posted';

  INSERT INTO venue_cost_accruals (
    organization_id, rule_version_id, closure_id, accrual_kind, accrual_status,
    accrual_date, amount, currency, rule_snapshot, source_snapshot, created_by,
    adjusts_accrual_id, reason
  ) VALUES (
    p_org_id, v_rule.id, v_closure.id, 'adjustment', 'posted',
    v_closure.occurrence_date, round(v_match.amount, 2),
    COALESCE(v_match.currency, NULLIF(v_rule.rules ->> 'currency', ''), 'RUB'),
    to_jsonb(v_rule), v_closure.source_snapshot, p_actor_id,
    p_accrual_id, 'correction_after_rule_accept'
  );

  UPDATE lesson_occurrence_closures
  SET pricing_status = 'priced',
      rule_version_id = v_rule.id
  WHERE id = v_closure.id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION venue_cost_reprice_zero_lesson_accruals(
  p_org_id uuid,
  p_rule venue_cost_rule_versions,
  p_actor_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_fixed integer := 0;
BEGIN
  IF p_rule.id IS NULL OR p_rule.mode <> 'per_lesson' THEN
    RETURN 0;
  END IF;

  FOR v_row IN
    SELECT c.id AS closure_id, a.id AS accrual_id
    FROM lesson_occurrence_closures c
    JOIN venue_cost_accruals a
      ON a.organization_id = c.organization_id
     AND a.closure_id = c.id
     AND a.accrual_status = 'posted'
     AND a.accrual_kind = 'lesson'
     AND a.teacher_pay_rule_id IS NULL
     AND COALESCE(a.amount, 0) = 0
    WHERE c.organization_id = p_org_id
      AND c.status = 'closed'
      AND c.occurrence_date BETWEEN p_rule.valid_from AND COALESCE(p_rule.valid_to, 'infinity'::date)
    ORDER BY c.occurrence_date, c.id
  LOOP
    IF venue_cost_reprice_zero_lesson_accrual(
      p_org_id, v_row.closure_id, v_row.accrual_id, p_actor_id
    ) THEN
      v_fixed := v_fixed + 1;
    END IF;
  END LOOP;

  RETURN v_fixed;
END;
$$;

CREATE OR REPLACE FUNCTION accept_venue_cost_rule_version(
  p_rule_version_id uuid,
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
  v_rule venue_cost_rule_versions%ROWTYPE;
  v_cursor date;
  v_period_from date;
  v_period_to date;
  v_result jsonb;
  v_cached jsonb;
  v_fingerprint text := md5(COALESCE(p_rule_version_id::text, ''));
  v_closure record;
  v_loc_row record;
  v_has_locations boolean;
  v_repriced_zero integer := 0;
BEGIN
  v_cached := check_operation_idempotency(v_org_id, 'accept_venue_cost_rule_version', p_idempotency_key, v_fingerprint);
  IF v_cached IS NOT NULL THEN
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL OR NOT member_can_manage_venue_cost_rules() THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_org_id::text || ':venue-rules', 0));
  SELECT * INTO v_rule
  FROM venue_cost_rule_versions
  WHERE id = p_rule_version_id AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'rule_not_found');
  END IF;
  IF v_rule.status = 'accepted' THEN
    RETURN jsonb_build_object('success', true, 'rule_version_id', v_rule.id, 'already_applied', true);
  END IF;
  IF NOT venue_cost_rule_references_are_valid(v_org_id, v_rule.mode, v_rule.rules) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_rule_reference');
  END IF;
  IF venue_cost_versions_have_conflict(
    v_org_id,
    v_rule.id,
    v_rule.mode,
    v_rule.rules,
    v_rule.valid_from,
    v_rule.valid_to
  ) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'accepted_rule_overlap');
  END IF;

  UPDATE venue_cost_rule_versions
  SET status = 'accepted', accepted_by = v_member_id, accepted_at = now()
  WHERE id = v_rule.id
  RETURNING * INTO v_rule;

  IF v_rule.mode = 'fixed_period' THEN
    v_has_locations := jsonb_array_length(COALESCE(v_rule.rules -> 'locations', '[]'::jsonb)) > 0;
    v_cursor := v_rule.valid_from;
    WHILE v_cursor <= v_rule.valid_to LOOP
      v_period_from := v_cursor;
      IF v_rule.rules ->> 'period' = 'week' THEN
        v_period_to := LEAST(v_rule.valid_to, v_cursor + 6);
        v_cursor := v_period_to + 1;
      ELSIF v_rule.rules ->> 'period' = 'month' THEN
        v_period_to := LEAST(v_rule.valid_to, (date_trunc('month', v_cursor) + interval '1 month - 1 day')::date);
        v_cursor := v_period_to + 1;
      ELSE
        v_period_to := v_rule.valid_to;
        v_cursor := v_rule.valid_to + 1;
      END IF;

      IF v_has_locations THEN
        FOR v_loc_row IN
          SELECT
            NULLIF(elem ->> 'location_id', '')::uuid AS location_id,
            round((elem ->> 'amount')::numeric, 2) AS amount
          FROM jsonb_array_elements(v_rule.rules -> 'locations') elem
        LOOP
          INSERT INTO venue_cost_accruals (
            organization_id, rule_version_id, location_id, accrual_kind, accrual_status, accrual_date,
            period_from, period_to, amount, currency, rule_snapshot, source_snapshot, created_by
          ) VALUES (
            v_org_id, v_rule.id, v_loc_row.location_id, 'fixed_period', 'posted', v_period_to,
            v_period_from, v_period_to, v_loc_row.amount,
            COALESCE(NULLIF(v_rule.rules ->> 'currency', ''), 'RUB'),
            to_jsonb(v_rule),
            jsonb_build_object('period', v_rule.rules ->> 'period', 'location_id', v_loc_row.location_id),
            v_member_id
          );
        END LOOP;
      ELSE
        INSERT INTO venue_cost_accruals (
          organization_id, rule_version_id, location_id, accrual_kind, accrual_status, accrual_date,
          period_from, period_to, amount, currency, rule_snapshot, source_snapshot, created_by
        ) VALUES (
          v_org_id, v_rule.id, NULL, 'fixed_period', 'posted', v_period_to,
          v_period_from, v_period_to, round((v_rule.rules ->> 'amount')::numeric, 2),
          COALESCE(NULLIF(v_rule.rules ->> 'currency', ''), 'RUB'),
          to_jsonb(v_rule), jsonb_build_object('period', v_rule.rules ->> 'period'), v_member_id
        );
      END IF;
    END LOOP;
  END IF;

  FOR v_closure IN
    SELECT c.id
    FROM lesson_occurrence_closures c
    WHERE c.organization_id = v_org_id
      AND c.status = 'closed'
      AND c.pricing_status = 'pending_unpriced'
      AND c.occurrence_date BETWEEN v_rule.valid_from AND COALESCE(v_rule.valid_to, 'infinity'::date)
    ORDER BY c.occurrence_date, c.id
  LOOP
    PERFORM post_venue_cost_for_closure(v_closure.id, v_member_id);
  END LOOP;

  IF v_rule.mode = 'per_lesson' THEN
    v_repriced_zero := venue_cost_reprice_zero_lesson_accruals(v_org_id, v_rule, v_member_id);
  END IF;

  v_result := jsonb_build_object(
    'success', true,
    'rule_version_id', v_rule.id,
    'repriced_zero_lesson_accruals', v_repriced_zero
  );
  PERFORM store_operation_idempotency(v_org_id, 'accept_venue_cost_rule_version', p_idempotency_key, v_fingerprint, v_result);
  RETURN v_result;
END;
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
    WHEN p_detail_kind = 'venue_adjustment' THEN
      TRIM(BOTH ' · ' FROM CONCAT_WS(
        ' · ',
        venue_cost_accrual_reason_label(p_reason),
        CASE
          WHEN NULLIF(btrim(p_title), '') IS NOT NULL THEN btrim(p_title)
          WHEN NULLIF(btrim(p_discipline_name), '') IS NOT NULL THEN btrim(p_discipline_name)
          ELSE NULL
        END,
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
    WHEN NULLIF(btrim(p_reason), '') IS NOT NULL THEN venue_cost_accrual_reason_label(p_reason)
    ELSE COALESCE(NULLIF(btrim(p_title), ''), 'Затраты на зал')
  END;
$$;

-- One-time fix: reprice existing zero lesson accruals where a rule match exists now.
DO $$
DECLARE
  v_org record;
  v_row record;
  v_actor uuid;
  v_fixed integer := 0;
  v_total integer := 0;
BEGIN
  FOR v_org IN
    SELECT DISTINCT organization_id
    FROM venue_cost_accruals
    WHERE accrual_status = 'posted'
      AND accrual_kind = 'lesson'
      AND teacher_pay_rule_id IS NULL
      AND COALESCE(amount, 0) = 0
  LOOP
    SELECT id INTO v_actor
    FROM organization_members
    WHERE organization_id = v_org.organization_id
      AND role = 'owner'
      AND is_active
    ORDER BY joined_at
    LIMIT 1;

    IF v_actor IS NULL THEN
      CONTINUE;
    END IF;

    FOR v_row IN
      SELECT c.id AS closure_id, a.id AS accrual_id
      FROM lesson_occurrence_closures c
      JOIN venue_cost_accruals a
        ON a.organization_id = c.organization_id
       AND a.closure_id = c.id
       AND a.accrual_status = 'posted'
       AND a.accrual_kind = 'lesson'
       AND a.teacher_pay_rule_id IS NULL
       AND COALESCE(a.amount, 0) = 0
      WHERE c.organization_id = v_org.organization_id
        AND c.status = 'closed'
      ORDER BY c.occurrence_date, c.id
    LOOP
      IF venue_cost_reprice_zero_lesson_accrual(
        v_org.organization_id, v_row.closure_id, v_row.accrual_id, v_actor
      ) THEN
        v_fixed := v_fixed + 1;
      END IF;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'venue_cost_zero_lesson_repriced_total=%', v_fixed;
END $$;

COMMIT;
