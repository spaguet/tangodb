-- Atomic batch cancel of recurring group lesson occurrences (CRM scenario 2 / Prompt 2)

BEGIN;

CREATE OR REPLACE FUNCTION _is_group_slot_occurrence_date(
  p_slot schedule_slots,
  p_date date
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_valid_from date := COALESCE(p_slot.valid_from, DATE '2000-01-01');
BEGIN
  IF EXTRACT(ISODOW FROM p_date)::integer <> p_slot.day_of_week THEN
    RETURN false;
  END IF;

  IF p_date < v_valid_from THEN
    RETURN false;
  END IF;

  IF p_slot.valid_to IS NOT NULL AND p_date > p_slot.valid_to THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION cancel_group_lesson_occurrences(
  p_slot_id uuid,
  p_cancel_dates text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_slot schedule_slots%ROWTYPE;
  v_cancel_text text;
  v_cancel date;
  v_cancel_dates date[] := ARRAY[]::date[];
  v_sorted date[];
  v_valid_count integer;
  v_current_start date;
  v_close_to date;
  v_valid_from date;
  v_valid_to date;
  v_segment_count integer := 0;
  v_first_segment boolean := true;
  v_seg_from date;
  v_seg_to date;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.orgReadOnly');
  END IF;

  IF NOT member_can_write_schedule_slot(p_slot_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.cancelForbidden');
  END IF;

  IF p_cancel_dates IS NULL OR array_length(p_cancel_dates, 1) IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.cancelDatesEmpty');
  END IF;

  SELECT *
  INTO v_slot
  FROM schedule_slots ss
  WHERE ss.id = p_slot_id
    AND ss.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.slotNotFound');
  END IF;

  IF v_slot.valid_to IS NOT NULL AND v_slot.valid_to <= v_slot.valid_from THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.cancelNotRecurring');
  END IF;

  v_valid_from := COALESCE(v_slot.valid_from, DATE '2000-01-01');
  v_valid_to := v_slot.valid_to;

  FOREACH v_cancel_text IN ARRAY p_cancel_dates LOOP
    IF v_cancel_text IS NULL OR v_cancel_text !~ '^\d{4}-\d{2}-\d{2}$' THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.error.cancelDateInvalid');
    END IF;

    BEGIN
      v_cancel := v_cancel_text::date;
    EXCEPTION
      WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', 'schedule.error.cancelDateInvalid');
    END;

    IF v_cancel = ANY (v_cancel_dates) THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.error.cancelDatesDuplicate');
    END IF;

    v_cancel_dates := array_append(v_cancel_dates, v_cancel);
  END LOOP;

  SELECT count(*)
  INTO v_valid_count
  FROM unnest(v_cancel_dates) AS d
  WHERE _is_group_slot_occurrence_date(v_slot, d);

  IF v_valid_count = 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'cancelled_count', 0,
      'already_applied', true
    );
  END IF;

  IF v_valid_count <> array_length(v_cancel_dates, 1) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.cancelDateInvalid');
  END IF;

  SELECT array_agg(d ORDER BY d)
  INTO v_sorted
  FROM unnest(v_cancel_dates) AS d;

  CREATE TEMP TABLE _cancel_segments (
    valid_from date NOT NULL,
    valid_to date
  ) ON COMMIT DROP;

  v_current_start := v_valid_from;

  FOREACH v_cancel IN ARRAY v_sorted LOOP
    v_close_to := v_cancel - 7;
    IF v_close_to >= v_current_start THEN
      INSERT INTO _cancel_segments (valid_from, valid_to)
      VALUES (v_current_start, v_close_to);
    END IF;
    v_current_start := v_cancel + 7;
  END LOOP;

  IF v_valid_to IS NULL OR v_current_start <= v_valid_to THEN
    INSERT INTO _cancel_segments (valid_from, valid_to)
    VALUES (v_current_start, v_valid_to);
  END IF;

  SELECT count(*) INTO v_segment_count FROM _cancel_segments;

  IF v_segment_count = 0 THEN
    DELETE FROM schedule_slots WHERE id = p_slot_id;
  ELSIF v_segment_count = 1 THEN
    SELECT valid_from, valid_to
    INTO v_seg_from, v_seg_to
    FROM _cancel_segments
    LIMIT 1;

    UPDATE schedule_slots
    SET valid_from = v_seg_from,
        valid_to = v_seg_to
    WHERE id = p_slot_id;
  ELSE
    DELETE FROM schedule_slots WHERE id = p_slot_id;

    v_first_segment := true;
    FOR v_seg_from, v_seg_to IN
      SELECT valid_from, valid_to FROM _cancel_segments ORDER BY valid_from
    LOOP
      IF v_first_segment THEN
        INSERT INTO schedule_slots (
          id,
          organization_id,
          day_of_week,
          time,
          time_end,
          discipline_id,
          group_name,
          location_id,
          teacher_member_id,
          class_id,
          valid_from,
          valid_to
        )
        VALUES (
          p_slot_id,
          v_slot.organization_id,
          v_slot.day_of_week,
          v_slot.time,
          v_slot.time_end,
          v_slot.discipline_id,
          v_slot.group_name,
          v_slot.location_id,
          v_slot.teacher_member_id,
          v_slot.class_id,
          v_seg_from,
          v_seg_to
        );
        v_first_segment := false;
      ELSE
        INSERT INTO schedule_slots (
          organization_id,
          day_of_week,
          time,
          time_end,
          discipline_id,
          group_name,
          location_id,
          teacher_member_id,
          class_id,
          valid_from,
          valid_to
        )
        VALUES (
          v_slot.organization_id,
          v_slot.day_of_week,
          v_slot.time,
          v_slot.time_end,
          v_slot.discipline_id,
          v_slot.group_name,
          v_slot.location_id,
          v_slot.teacher_member_id,
          v_slot.class_id,
          v_seg_from,
          v_seg_to
        );
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'cancelled_count', array_length(v_sorted, 1)
  );
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
  WHEN OTHERS THEN
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION cancel_group_lesson_occurrences(uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_group_lesson_occurrences(uuid, text[]) TO authenticated;

COMMIT;
