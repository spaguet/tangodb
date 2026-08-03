-- Hall-rent stage 14: fixed-period venue cost per location (legacy org-wide amount preserved).

BEGIN;

ALTER TABLE venue_cost_accruals
  ADD COLUMN IF NOT EXISTS location_id UUID;

ALTER TABLE venue_cost_accruals
  DROP CONSTRAINT IF EXISTS venue_cost_accruals_organization_id_location_id_fkey;

ALTER TABLE venue_cost_accruals
  ADD CONSTRAINT venue_cost_accruals_organization_id_location_id_fkey
  FOREIGN KEY (organization_id, location_id)
  REFERENCES locations (organization_id, id);

DROP INDEX IF EXISTS venue_cost_fixed_period_unique;

CREATE UNIQUE INDEX venue_cost_fixed_period_unique
  ON venue_cost_accruals (
    organization_id,
    rule_version_id,
    period_from,
    period_to,
    COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE accrual_kind = 'fixed_period' AND accrual_status = 'posted';

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
    PERFORM (v_rule ->> 'teacher_member_id')::uuid;
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
  v_teacher_member_id uuid;
BEGIN
  IF p_mode = 'fixed_period' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_rules -> 'locations', '[]'::jsonb))
    LOOP
      v_location_id := NULLIF(v_item ->> 'location_id', '')::uuid;
      IF v_location_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM locations l
        WHERE l.organization_id = p_org_id AND l.id = v_location_id
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
    v_discipline_id := NULLIF(v_item ->> 'discipline_id', '')::uuid;
    v_location_id := NULLIF(v_item ->> 'location_id', '')::uuid;
    v_teacher_member_id := NULLIF(v_item ->> 'teacher_member_id', '')::uuid;

    IF v_teacher_member_id IS NULL THEN
      RETURN false;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = p_org_id AND om.id = v_teacher_member_id
    ) THEN
      RETURN false;
    END IF;

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
  IF EXISTS (
    SELECT 1 FROM venue_cost_rule_versions r
    WHERE r.organization_id = v_org_id AND r.status = 'accepted'
      AND daterange(r.valid_from, COALESCE(r.valid_to, 'infinity'::date), '[]')
          && daterange(v_rule.valid_from, COALESCE(v_rule.valid_to, 'infinity'::date), '[]')
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

  v_result := jsonb_build_object('success', true, 'rule_version_id', v_rule.id);
  PERFORM store_operation_idempotency(v_org_id, 'accept_venue_cost_rule_version', p_idempotency_key, v_fingerprint, v_result);
  RETURN v_result;
END;
$$;

COMMIT;
