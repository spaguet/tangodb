-- Migrate teacher-scoped venue cost per-lesson rules into teacher_pay_rules;
-- venue cost per_lesson becomes org-wide (no teacher_member_id).

BEGIN;

-- Migrate accepted per_lesson rules with teacher scope → teacher_pay_rules (fixed amounts).
INSERT INTO teacher_pay_rules (
  organization_id,
  member_id,
  lesson_kind,
  discipline_id,
  schedule_group_id,
  amount_type,
  value,
  expense_category,
  valid_from,
  valid_to,
  created_by,
  created_at
)
SELECT
  v.organization_id,
  NULLIF(item ->> 'teacher_member_id', '')::uuid,
  'personal',
  NULLIF(item ->> 'discipline_id', '')::uuid,
  NULL,
  'fixed',
  (item ->> 'amount')::numeric,
  NULL,
  v.valid_from,
  v.valid_to,
  v.accepted_by,
  COALESCE(v.accepted_at, v.created_at)
FROM venue_cost_rule_versions v
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(v.rules -> 'personal', '[]'::jsonb)) AS item
WHERE v.status = 'accepted'
  AND v.mode = 'per_lesson'
  AND NULLIF(item ->> 'teacher_member_id', '') IS NOT NULL
  AND (item ->> 'amount') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM teacher_pay_rules tpr
    WHERE tpr.organization_id = v.organization_id
      AND tpr.member_id = NULLIF(item ->> 'teacher_member_id', '')::uuid
      AND tpr.lesson_kind = 'personal'
      AND tpr.discipline_id IS NOT DISTINCT FROM NULLIF(item ->> 'discipline_id', '')::uuid
      AND tpr.schedule_group_id IS NULL
      AND tpr.amount_type = 'fixed'
      AND tpr.valid_from = v.valid_from
  );

INSERT INTO teacher_pay_rules (
  organization_id,
  member_id,
  lesson_kind,
  discipline_id,
  schedule_group_id,
  amount_type,
  value,
  expense_category,
  valid_from,
  valid_to,
  created_by,
  created_at
)
SELECT
  v.organization_id,
  NULLIF(item ->> 'teacher_member_id', '')::uuid,
  'group',
  NULLIF(item ->> 'discipline_id', '')::uuid,
  NULL,
  'fixed',
  COALESCE(
    (
      SELECT (tier ->> 'amount')::numeric
      FROM jsonb_array_elements(COALESCE(item -> 'attendance_tiers', '[]'::jsonb)) tier
      ORDER BY (tier ->> 'min_attendees')::integer
      LIMIT 1
    ),
    0
  ),
  NULL,
  v.valid_from,
  v.valid_to,
  v.accepted_by,
  COALESCE(v.accepted_at, v.created_at)
FROM venue_cost_rule_versions v
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(v.rules -> 'group', '[]'::jsonb)) AS item
WHERE v.status = 'accepted'
  AND v.mode = 'per_lesson'
  AND NULLIF(item ->> 'teacher_member_id', '') IS NOT NULL
  AND jsonb_array_length(COALESCE(item -> 'attendance_tiers', '[]'::jsonb)) = 1
  AND NOT EXISTS (
    SELECT 1 FROM teacher_pay_rules tpr
    WHERE tpr.organization_id = v.organization_id
      AND tpr.member_id = NULLIF(item ->> 'teacher_member_id', '')::uuid
      AND tpr.lesson_kind = 'group'
      AND tpr.discipline_id IS NOT DISTINCT FROM NULLIF(item ->> 'discipline_id', '')::uuid
      AND tpr.schedule_group_id IS NULL
      AND tpr.amount_type = 'fixed'
      AND tpr.valid_from = v.valid_from
  );

-- Strip teacher-scoped rows from accepted venue cost rule JSON (keep org-wide rows only).
SELECT set_config('app.venue_cost_org_wide_migration', 'on', true);
UPDATE venue_cost_rule_versions v
SET rules = jsonb_set(
  jsonb_set(
    v.rules,
    '{personal}',
    COALESCE((
      SELECT jsonb_agg(item)
      FROM jsonb_array_elements(COALESCE(v.rules -> 'personal', '[]'::jsonb)) item
      WHERE NULLIF(item ->> 'teacher_member_id', '') IS NULL
    ), '[]'::jsonb),
    true
  ),
  '{group}',
  COALESCE((
    SELECT jsonb_agg(item)
    FROM jsonb_array_elements(COALESCE(v.rules -> 'group', '[]'::jsonb)) item
    WHERE NULLIF(item ->> 'teacher_member_id', '') IS NULL
  ), '[]'::jsonb),
  true
)
WHERE v.mode = 'per_lesson'
  AND v.status = 'accepted'
  AND (
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(v.rules -> 'personal', '[]'::jsonb)) item
      WHERE NULLIF(item ->> 'teacher_member_id', '') IS NOT NULL
    )
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(v.rules -> 'group', '[]'::jsonb)) item
      WHERE NULLIF(item ->> 'teacher_member_id', '') IS NOT NULL
    )
  );
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
BEGIN
  IF p_mode = 'disabled' THEN
    RETURN p_rules IS NOT NULL AND jsonb_typeof(p_rules) = 'object';
  END IF;

  IF p_rules IS NULL OR jsonb_typeof(p_rules) <> 'object' THEN
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

CREATE OR REPLACE FUNCTION venue_cost_rule_references_are_valid(
  p_org_id uuid,
  p_mode text,
  p_rules jsonb
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item jsonb;
  v_discipline_id uuid;
  v_location_id uuid;
BEGIN
  IF p_mode = 'fixed_period' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_rules -> 'locations', '[]'::jsonb))
    LOOP
      IF NULLIF(v_item ->> 'location_id', '') IS NULL OR NOT EXISTS (
        SELECT 1 FROM locations l
        WHERE l.organization_id = p_org_id AND l.id = NULLIF(v_item ->> 'location_id', '')::uuid
      ) THEN
        RETURN false;
      END IF;
    END LOOP;
    RETURN true;
  END IF;

  IF p_mode <> 'per_lesson' THEN
    RETURN true;
  END IF;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(COALESCE(p_rules -> 'group', '[]'::jsonb))
    UNION ALL
    SELECT value FROM jsonb_array_elements(COALESCE(p_rules -> 'personal', '[]'::jsonb))
  LOOP
    IF NULLIF(v_item ->> 'teacher_member_id', '') IS NOT NULL THEN
      RETURN false;
    END IF;

    v_discipline_id := NULLIF(v_item ->> 'discipline_id', '')::uuid;
    v_location_id := NULLIF(v_item ->> 'location_id', '')::uuid;

    IF v_discipline_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM disciplines d
      WHERE d.organization_id = p_org_id AND d.id = v_discipline_id
    ) THEN
      RETURN false;
    END IF;

    IF v_location_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM locations l
      WHERE l.organization_id = p_org_id AND l.id = v_location_id
    ) THEN
      RETURN false;
    END IF;
  END LOOP;

  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

COMMIT;
