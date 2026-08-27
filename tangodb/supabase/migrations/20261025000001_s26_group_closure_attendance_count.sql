-- S26 / M59: close_group_lesson_occurrence counts present attendees from attendance
-- (plus single visits) — client p_confirmed_attendee_count must match; capped by classes.max_capacity.

BEGIN;

CREATE OR REPLACE FUNCTION _group_occurrence_present_attendee_count(
  p_org_id uuid,
  p_occurrence_date date,
  p_schedule_slot_id uuid,
  p_schedule_group_id uuid
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    coalesce((
      SELECT sum(_group_subscription_participant_count(s.type))::integer
      FROM attendance a
      JOIN subscriptions s
        ON s.id = a.subscription_id
       AND s.organization_id = p_org_id
      WHERE a.organization_id = p_org_id
        AND a.date = p_occurrence_date
        AND a.schedule_group_id = p_schedule_group_id
        AND a.attendance_status = 'present'
    ), 0)
    + coalesce((
      SELECT count(*)::integer
      FROM single_visits sv
      WHERE sv.organization_id = p_org_id
        AND sv.visit_date = p_occurrence_date
        AND sv.schedule_slot_id = p_schedule_slot_id
    ), 0);
$$;

REVOKE ALL ON FUNCTION _group_occurrence_present_attendee_count(uuid, date, uuid, uuid) FROM PUBLIC;

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
  v_present_count integer;
  v_max_capacity integer;
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

  v_present_count := _group_occurrence_present_attendee_count(
    v_org_id, p_occurrence_date, v_slot.id, v_slot.class_id
  );

  IF p_confirmed_attendee_count IS DISTINCT FROM v_present_count THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'attendee_count_mismatch',
      'present_attendee_count', v_present_count,
      'confirmed_attendee_count', p_confirmed_attendee_count
    );
  END IF;

  SELECT c.max_capacity INTO v_max_capacity
  FROM classes c
  WHERE c.id = v_slot.class_id AND c.organization_id = v_org_id;

  IF v_max_capacity IS NOT NULL AND v_present_count > v_max_capacity THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'attendee_count_exceeds_capacity',
      'present_attendee_count', v_present_count,
      'max_capacity', v_max_capacity
    );
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
    v_slot.location_id, v_slot.teacher_member_id, v_present_count,
    jsonb_build_object(
      'schedule_slot_id', v_slot.id, 'class_id', v_slot.class_id,
      'discipline_id', v_slot.discipline_id, 'location_id', v_slot.location_id,
      'teacher_member_id', v_slot.teacher_member_id,
      'confirmed_attendee_count', v_present_count,
      'present_attendee_count', v_present_count
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

REVOKE ALL ON FUNCTION close_group_lesson_occurrence(uuid, date, integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION close_group_lesson_occurrence(uuid, date, integer, uuid) TO authenticated;

COMMIT;
