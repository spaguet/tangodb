-- One-off follow-up for Omow dance org after 20260887000001.
-- Updates payee, closes past personal lessons, recalculates pending, fixes zero accruals under 150k rule.

BEGIN;

SELECT set_config('app.venue_cost_org_wide_migration', 'on', true);

UPDATE venue_cost_rule_versions
SET rules = jsonb_set(rules, '{payee}', to_jsonb('Арендодатель зала'::text), true)
WHERE organization_id = '8da4b806-f9c8-49eb-8431-ec7e0a5390a1'
  AND mode <> 'disabled'
  AND btrim(COALESCE(rules ->> 'payee', '')) IN ('—', '', 'Арендодатель');

SELECT set_config('app.venue_cost_org_wide_migration', 'off', true);

DO $$
DECLARE
  v_org_id uuid := '8da4b806-f9c8-49eb-8431-ec7e0a5390a1';
  v_member_id uuid;
  v_lesson personal_lessons%ROWTYPE;
  v_closure_id uuid;
  v_closed integer := 0;
BEGIN
  SELECT id INTO v_member_id
  FROM organization_members
  WHERE organization_id = v_org_id AND role = 'owner' AND is_active
  ORDER BY joined_at
  LIMIT 1;

  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'owner_member_not_found';
  END IF;

  FOR v_lesson IN
    SELECT p.*
    FROM personal_lessons p
    WHERE p.organization_id = v_org_id
      AND p.date <= current_date
      AND p.cancelled_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM lesson_occurrence_closures c
        WHERE c.organization_id = v_org_id
          AND c.source_personal_lesson_id = p.id
          AND c.status = 'closed'
      )
    ORDER BY p.date, p.id
  LOOP
    INSERT INTO lesson_occurrence_closures (
      organization_id, occurrence_kind, occurrence_date, personal_lesson_id,
      source_personal_lesson_id,
      discipline_id, location_id, teacher_member_id, source_snapshot, closed_by
    ) VALUES (
      v_org_id, 'personal', v_lesson.date, v_lesson.id, v_lesson.id,
      v_lesson.discipline_id, v_lesson.location_id, v_lesson.teacher_member_id,
      to_jsonb(v_lesson), v_member_id
    ) RETURNING id INTO v_closure_id;

    PERFORM post_venue_cost_for_closure(v_closure_id, v_member_id);
    v_closed := v_closed + 1;
  END LOOP;

  RAISE NOTICE 'closed_personal_lessons=%', v_closed;
END $$;

-- Re-price closures that posted 0 while a per-lesson personal rule with amount > 0 was active.
DO $$
DECLARE
  v_org_id uuid := '8da4b806-f9c8-49eb-8431-ec7e0a5390a1';
  v_member_id uuid;
  v_row record;
  v_rule venue_cost_rule_versions%ROWTYPE;
  v_amount numeric;
  v_fixed integer := 0;
BEGIN
  SELECT id INTO v_member_id
  FROM organization_members
  WHERE organization_id = v_org_id AND role = 'owner' AND is_active
  LIMIT 1;

  FOR v_row IN
    SELECT c.id AS closure_id, c.occurrence_date, c.discipline_id, c.location_id,
           c.teacher_member_id, a.id AS accrual_id, a.amount
    FROM lesson_occurrence_closures c
    JOIN venue_cost_accruals a
      ON a.organization_id = c.organization_id
     AND a.closure_id = c.id
     AND a.accrual_status = 'posted'
     AND a.teacher_pay_rule_id IS NULL
     AND a.accrual_kind = 'lesson'
    WHERE c.organization_id = v_org_id
      AND c.status = 'closed'
      AND c.occurrence_kind = 'personal'
      AND COALESCE(a.amount, 0) = 0
  LOOP
    SELECT * INTO v_rule FROM venue_cost_rule_at(v_org_id, v_row.occurrence_date);
    IF v_rule.id IS NULL OR v_rule.mode <> 'per_lesson' THEN
      CONTINUE;
    END IF;

    v_amount := venue_cost_amount_for_lesson(
      v_rule, 'personal', v_row.discipline_id, v_row.location_id, NULL, v_row.teacher_member_id
    );
    IF v_amount IS NULL OR v_amount <= 0 THEN
      CONTINUE;
    END IF;

    UPDATE venue_cost_accruals
    SET accrual_status = 'void',
        amount = 0,
        reason = 'corrected_zero_accrual:' || v_rule.id::text
    WHERE id = v_row.accrual_id AND organization_id = v_org_id;

    INSERT INTO venue_cost_accruals (
      organization_id, rule_version_id, closure_id, accrual_kind, accrual_status,
      accrual_date, amount, currency, rule_snapshot, source_snapshot, created_by,
      adjusts_accrual_id, reason
    )
    SELECT
      v_org_id, v_rule.id, v_row.closure_id, 'adjustment', 'posted',
      v_row.occurrence_date, round(v_amount, 2),
      COALESCE(NULLIF(v_rule.rules ->> 'currency', ''), 'RUB'),
      to_jsonb(v_rule), c.source_snapshot, v_member_id,
      v_row.accrual_id, 'correction_after_rule_accept'
    FROM lesson_occurrence_closures c
    WHERE c.id = v_row.closure_id;

    UPDATE lesson_occurrence_closures
    SET pricing_status = 'priced', rule_version_id = v_rule.id
    WHERE id = v_row.closure_id;

    v_fixed := v_fixed + 1;
  END LOOP;

  RAISE NOTICE 'corrected_zero_accruals=%', v_fixed;
END $$;

DO $$
DECLARE
  v_org_id uuid := '8da4b806-f9c8-49eb-8431-ec7e0a5390a1';
  v_member_id uuid;
  v_closure_id uuid;
  v_repriced integer := 0;
BEGIN
  SELECT id INTO v_member_id
  FROM organization_members
  WHERE organization_id = v_org_id AND role = 'owner' AND is_active
  LIMIT 1;

  FOR v_closure_id IN
    SELECT c.id
    FROM lesson_occurrence_closures c
    WHERE c.organization_id = v_org_id
      AND c.status = 'closed'
      AND c.pricing_status = 'pending_unpriced'
  LOOP
    PERFORM post_venue_cost_for_closure(v_closure_id, v_member_id);
    v_repriced := v_repriced + 1;
  END LOOP;

  RAISE NOTICE 'repriced_pending_closures=%', v_repriced;
END $$;

COMMIT;
