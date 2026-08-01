-- Venue cost per-lesson rules: match by teacher_member_id; store teacher on closures.

BEGIN;

ALTER TABLE lesson_occurrence_closures
  ADD COLUMN IF NOT EXISTS teacher_member_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lesson_occurrence_closures_teacher_member_fk'
  ) THEN
    ALTER TABLE lesson_occurrence_closures
      ADD CONSTRAINT lesson_occurrence_closures_teacher_member_fk
      FOREIGN KEY (organization_id, teacher_member_id)
      REFERENCES organization_members (organization_id, id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION venue_cost_rules_are_valid(p_mode text, p_rules jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_rule jsonb;
  v_tier jsonb;
  v_expected_min integer;
  v_min integer;
  v_max integer;
BEGIN
  IF p_mode = 'disabled' THEN
    RETURN p_rules IS NOT NULL AND jsonb_typeof(p_rules) = 'object';
  END IF;

  IF p_rules IS NULL OR jsonb_typeof(p_rules) <> 'object' THEN
    RETURN false;
  END IF;

  IF p_mode = 'fixed_period' THEN
    RETURN p_rules ->> 'period' IN ('week', 'month', 'custom')
      AND (p_rules ->> 'amount') IS NOT NULL
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
      OR NULLIF(v_rule ->> 'teacher_member_id', '') IS NULL
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
    PERFORM (v_rule ->> 'teacher_member_id')::uuid;
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
      OR NULLIF(v_rule ->> 'teacher_member_id', '') IS NULL
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

DROP FUNCTION IF EXISTS venue_cost_amount_for_lesson(venue_cost_rule_versions, text, uuid, uuid, integer);

CREATE OR REPLACE FUNCTION venue_cost_amount_for_lesson(
  p_rule venue_cost_rule_versions,
  p_kind text,
  p_discipline_id uuid,
  p_location_id uuid,
  p_attendee_count integer,
  p_teacher_member_id uuid DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_item jsonb;
  v_tier jsonb;
BEGIN
  IF p_rule.id IS NULL OR p_rule.mode IN ('disabled', 'fixed_period') THEN
    RETURN 0;
  END IF;

  IF p_kind = 'personal' THEN
    SELECT value INTO v_item
    FROM jsonb_array_elements(COALESCE(p_rule.rules -> 'personal', '[]'::jsonb))
    WHERE ((value ->> 'teacher_member_id') IS NULL OR (value ->> 'teacher_member_id')::uuid = p_teacher_member_id)
      AND ((value ->> 'discipline_id') IS NULL OR (value ->> 'discipline_id')::uuid = p_discipline_id)
      AND ((value ->> 'location_id') IS NULL OR (value ->> 'location_id')::uuid = p_location_id)
    ORDER BY
      (CASE WHEN value ->> 'teacher_member_id' IS NULL THEN 0 ELSE 1 END
       + CASE WHEN value ->> 'discipline_id' IS NULL THEN 0 ELSE 1 END
       + CASE WHEN value ->> 'location_id' IS NULL THEN 0 ELSE 1 END) DESC,
      CASE WHEN value ->> 'teacher_member_id' IS NULL THEN 1 ELSE 0 END,
      CASE WHEN value ->> 'discipline_id' IS NULL THEN 1 ELSE 0 END,
      CASE WHEN value ->> 'location_id' IS NULL THEN 1 ELSE 0 END
    LIMIT 1;
    RETURN COALESCE((v_item ->> 'amount')::numeric, 0);
  END IF;

  SELECT value INTO v_item
  FROM jsonb_array_elements(COALESCE(p_rule.rules -> 'group', '[]'::jsonb))
  WHERE ((value ->> 'teacher_member_id') IS NULL OR (value ->> 'teacher_member_id')::uuid = p_teacher_member_id)
    AND ((value ->> 'discipline_id') IS NULL OR (value ->> 'discipline_id')::uuid = p_discipline_id)
    AND ((value ->> 'location_id') IS NULL OR (value ->> 'location_id')::uuid = p_location_id)
  ORDER BY
    (CASE WHEN value ->> 'teacher_member_id' IS NULL THEN 0 ELSE 1 END
     + CASE WHEN value ->> 'discipline_id' IS NULL THEN 0 ELSE 1 END
     + CASE WHEN value ->> 'location_id' IS NULL THEN 0 ELSE 1 END) DESC,
    CASE WHEN value ->> 'teacher_member_id' IS NULL THEN 1 ELSE 0 END,
    CASE WHEN value ->> 'discipline_id' IS NULL THEN 1 ELSE 0 END,
    CASE WHEN value ->> 'location_id' IS NULL THEN 1 ELSE 0 END
  LIMIT 1;

  SELECT value INTO v_tier
  FROM jsonb_array_elements(COALESCE(v_item -> 'attendance_tiers', '[]'::jsonb))
  WHERE (value ->> 'min_attendees')::integer <= p_attendee_count
    AND (
      NULLIF(value ->> 'max_attendees', '') IS NULL
      OR (value ->> 'max_attendees')::integer >= p_attendee_count
    )
  ORDER BY (value ->> 'min_attendees')::integer DESC
  LIMIT 1;

  RETURN COALESCE((v_tier ->> 'amount')::numeric, 0);
END;
$$;

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
  v_closure lesson_occurrence_closures%ROWTYPE;
  v_rule venue_cost_rule_versions%ROWTYPE;
  v_amount numeric;
  v_accrual_id uuid;
BEGIN
  SELECT * INTO v_closure
  FROM lesson_occurrence_closures
  WHERE id = p_closure_id
  FOR UPDATE;

  IF NOT FOUND OR v_closure.status <> 'closed' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'closure_not_found');
  END IF;

  IF EXISTS (
    SELECT 1 FROM venue_cost_accruals a
    WHERE a.organization_id = v_closure.organization_id
      AND a.closure_id = v_closure.id
      AND a.accrual_status = 'posted'
  ) THEN
    RETURN jsonb_build_object('success', true, 'already_applied', true);
  END IF;

  SELECT * INTO v_rule
  FROM venue_cost_rule_at(v_closure.organization_id, v_closure.occurrence_date);

  IF v_rule.id IS NULL THEN
    INSERT INTO venue_cost_accruals (
      organization_id, closure_id, accrual_kind, accrual_status, accrual_date,
      source_snapshot, created_by
    ) VALUES (
      v_closure.organization_id, v_closure.id, 'lesson', 'pending_unpriced',
      v_closure.occurrence_date, v_closure.source_snapshot, p_actor_id
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_accrual_id;

    UPDATE lesson_occurrence_closures
    SET pricing_status = 'pending_unpriced', rule_version_id = NULL
    WHERE id = v_closure.id;

    RETURN jsonb_build_object(
      'success', true, 'closure_id', v_closure.id, 'accrual_id', v_accrual_id,
      'pricing_status', 'pending_unpriced'
    );
  END IF;

  v_amount := venue_cost_amount_for_lesson(
    v_rule, v_closure.occurrence_kind, v_closure.discipline_id, v_closure.location_id,
    v_closure.confirmed_attendee_count, v_closure.teacher_member_id
  );

  UPDATE venue_cost_accruals
  SET accrual_status = 'void', amount = 0,
      reason = 'resolved_by_rule:' || v_rule.id::text
  WHERE organization_id = v_closure.organization_id
    AND closure_id = v_closure.id
    AND accrual_status = 'pending_unpriced';

  INSERT INTO venue_cost_accruals (
    organization_id, rule_version_id, closure_id, accrual_kind, accrual_status,
    accrual_date, amount, currency, rule_snapshot, source_snapshot, created_by
  ) VALUES (
    v_closure.organization_id, v_rule.id, v_closure.id, 'lesson', 'posted',
    v_closure.occurrence_date, round(v_amount, 2),
    COALESCE(NULLIF(v_rule.rules ->> 'currency', ''), 'RUB'),
    to_jsonb(v_rule), v_closure.source_snapshot, p_actor_id
  )
  RETURNING id INTO v_accrual_id;

  UPDATE lesson_occurrence_closures
  SET pricing_status = CASE WHEN v_rule.mode = 'per_lesson' THEN 'priced' ELSE 'not_applicable' END,
      rule_version_id = v_rule.id
  WHERE id = v_closure.id;

  RETURN jsonb_build_object(
    'success', true, 'closure_id', v_closure.id, 'accrual_id', v_accrual_id,
    'pricing_status', CASE WHEN v_rule.mode = 'per_lesson' THEN 'priced' ELSE 'not_applicable' END,
    'amount', round(v_amount, 2), 'rule_version_id', v_rule.id
  );
END;
$$;

CREATE OR REPLACE FUNCTION close_group_lesson_occurrence(
  p_schedule_slot_id uuid,
  p_occurrence_date date,
  p_confirmed_attendee_count integer,
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
  v_slot schedule_slots%ROWTYPE;
  v_closure_id uuid;
  v_existing_attendee_count integer;
  v_fingerprint text;
  v_cached jsonb;
  v_result jsonb;
BEGIN
  v_fingerprint := md5(concat_ws('|', p_schedule_slot_id, p_occurrence_date, p_confirmed_attendee_count));
  v_cached := check_operation_idempotency(v_org_id, 'close_group_lesson_occurrence', p_idempotency_key, v_fingerprint);
  IF v_cached IS NOT NULL THEN RETURN v_cached || jsonb_build_object('already_applied', true); END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL
    OR NOT member_can_close_group_venue_occurrence(p_schedule_slot_id, p_occurrence_date)
  THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;
  IF p_occurrence_date IS NULL OR p_occurrence_date > current_date
    OR p_confirmed_attendee_count IS NULL OR p_confirmed_attendee_count < 0
  THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_occurrence');
  END IF;

  SELECT * INTO v_slot FROM schedule_slots s
  WHERE s.id = p_schedule_slot_id AND s.organization_id = v_org_id
    AND s.class_id IS NOT NULL
    AND s.day_of_week = EXTRACT(ISODOW FROM p_occurrence_date)::integer
    AND s.valid_from <= p_occurrence_date
    AND (s.valid_to IS NULL OR s.valid_to >= p_occurrence_date);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'group_occurrence_not_found');
  END IF;

  SELECT id, confirmed_attendee_count INTO v_closure_id, v_existing_attendee_count
  FROM lesson_occurrence_closures
  WHERE organization_id = v_org_id AND schedule_slot_id = v_slot.id
    AND occurrence_date = p_occurrence_date AND status = 'closed';
  IF v_closure_id IS NOT NULL THEN
    IF v_existing_attendee_count IS DISTINCT FROM p_confirmed_attendee_count THEN
      RETURN jsonb_build_object(
        'success', false, 'error_code', 'closure_attendee_count_conflict',
        'closure_id', v_closure_id,
        'confirmed_attendee_count', v_existing_attendee_count
      );
    END IF;
    RETURN jsonb_build_object('success', true, 'closure_id', v_closure_id, 'already_applied', true);
  END IF;

  INSERT INTO lesson_occurrence_closures (
    organization_id, occurrence_kind, occurrence_date, schedule_slot_id,
    discipline_id, location_id, teacher_member_id, confirmed_attendee_count, source_snapshot, closed_by
  ) VALUES (
    v_org_id, 'group', p_occurrence_date, v_slot.id, v_slot.discipline_id,
    v_slot.location_id, v_slot.teacher_member_id, p_confirmed_attendee_count,
    jsonb_build_object(
      'schedule_slot_id', v_slot.id, 'class_id', v_slot.class_id,
      'discipline_id', v_slot.discipline_id, 'location_id', v_slot.location_id,
      'teacher_member_id', v_slot.teacher_member_id,
      'confirmed_attendee_count', p_confirmed_attendee_count
    ), v_member_id
  ) RETURNING id INTO v_closure_id;

  v_result := post_venue_cost_for_closure(v_closure_id, v_member_id);
  IF NOT can_read_financial() THEN
    v_result := v_result - 'amount';
  END IF;
  PERFORM store_operation_idempotency(v_org_id, 'close_group_lesson_occurrence', p_idempotency_key, v_fingerprint, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION close_personal_lesson_occurrence(
  p_personal_lesson_id uuid,
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
  v_lesson personal_lessons%ROWTYPE;
  v_closure_id uuid;
  v_fingerprint text := md5(COALESCE(p_personal_lesson_id::text, ''));
  v_cached jsonb;
  v_result jsonb;
BEGIN
  v_cached := check_operation_idempotency(v_org_id, 'close_personal_lesson_occurrence', p_idempotency_key, v_fingerprint);
  IF v_cached IS NOT NULL THEN RETURN v_cached || jsonb_build_object('already_applied', true); END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL
    OR NOT member_can_close_personal_venue_occurrence(p_personal_lesson_id)
  THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  SELECT * INTO v_lesson FROM personal_lessons p
  WHERE p.id = p_personal_lesson_id AND p.organization_id = v_org_id
    AND p.date <= current_date AND p.cancelled_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'personal_lesson_not_found');
  END IF;

  SELECT id INTO v_closure_id FROM lesson_occurrence_closures
  WHERE organization_id = v_org_id
    AND source_personal_lesson_id = v_lesson.id
    AND status = 'closed';
  IF v_closure_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'closure_id', v_closure_id, 'already_applied', true);
  END IF;

  INSERT INTO lesson_occurrence_closures (
    organization_id, occurrence_kind, occurrence_date, personal_lesson_id,
    source_personal_lesson_id,
    discipline_id, location_id, teacher_member_id, source_snapshot, closed_by
  ) VALUES (
    v_org_id, 'personal', v_lesson.date, v_lesson.id, v_lesson.id, v_lesson.discipline_id,
    v_lesson.location_id, v_lesson.teacher_member_id, to_jsonb(v_lesson), v_member_id
  ) RETURNING id INTO v_closure_id;

  v_result := post_venue_cost_for_closure(v_closure_id, v_member_id);
  IF NOT can_read_financial() THEN
    v_result := v_result - 'amount';
  END IF;
  PERFORM store_operation_idempotency(v_org_id, 'close_personal_lesson_occurrence', p_idempotency_key, v_fingerprint, v_result);
  RETURN v_result;
END;
$$;

COMMIT;
