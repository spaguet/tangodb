-- Edit calendar event sessions with conflict resolution (CRM scenario 3 follow-up)

BEGIN;

DROP FUNCTION IF EXISTS preview_calendar_event_conflicts(jsonb);

CREATE OR REPLACE FUNCTION preview_calendar_event_conflicts(
  p_sessions jsonb,
  p_exclude_event_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_conflicts jsonb := '[]'::jsonb;
  v_session jsonb;
  v_date date;
  v_time_start text;
  v_time_end text;
  v_location_id uuid;
  v_dow integer;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT can_read_operational() AND current_member_role() <> 'teacher' THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF p_sessions IS NULL OR jsonb_typeof(p_sessions) <> 'array' OR jsonb_array_length(p_sessions) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.event.sessionsEmpty');
  END IF;

  FOR v_session IN SELECT value FROM jsonb_array_elements(p_sessions) LOOP
    IF v_session ->> 'date' IS NULL OR v_session ->> 'date' !~ '^\d{4}-\d{2}-\d{2}$' THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.event.sessionDateInvalid');
    END IF;

    v_date := (v_session ->> 'date')::date;
    v_time_start := normalize_hhmm(v_session ->> 'time_start');
    v_time_end := normalize_hhmm(v_session ->> 'time_end');
    v_location_id := (v_session ->> 'location_id')::uuid;
    v_dow := EXTRACT(ISODOW FROM v_date)::integer;

    IF v_time_end <= v_time_start THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.event.sessionInvalid');
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM locations l
      WHERE l.id = v_location_id AND l.organization_id = v_org_id
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.event.locationInvalid');
    END IF;

    v_conflicts := v_conflicts || COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'kind', 'group',
        'slot_id', s.id,
        'occurrence_date', v_date,
        'time_start', s.time,
        'time_end', s.time_end,
        'location_id', s.location_id,
        'group_name', COALESCE(s.group_name, ''),
        'teacher_member_id', s.teacher_member_id,
        'discipline_id', s.discipline_id
      ))
      FROM schedule_slots s
      WHERE s.organization_id = v_org_id
        AND s.day_of_week = v_dow
        AND s.location_id IS NOT DISTINCT FROM v_location_id
        AND s.valid_from <= v_date
        AND (s.valid_to IS NULL OR s.valid_to >= v_date)
        AND schedule_time_ranges_overlap(s.time, s.time_end, v_time_start, v_time_end)
    ), '[]'::jsonb);

    v_conflicts := v_conflicts || COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'kind', 'personal',
        'lesson_id', p.id,
        'occurrence_date', p.date,
        'time_start', p.time_start,
        'time_end', p.time_end,
        'location_id', p.location_id,
        'client_display', COALESCE(p.client_display, ''),
        'teacher_member_id', p.teacher_member_id,
        'discipline_id', p.discipline_id
      ))
      FROM personal_lessons p
      WHERE p.organization_id = v_org_id
        AND p.date = v_date
        AND p.cancelled_at IS NULL
        AND p.location_id IS NOT DISTINCT FROM v_location_id
        AND schedule_time_ranges_overlap(p.time_start, p.time_end, v_time_start, v_time_end)
    ), '[]'::jsonb);

    v_conflicts := v_conflicts || COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'kind', 'event',
        'event_id', ce.id,
        'session_id', ces.id,
        'occurrence_date', ces.session_date,
        'time_start', ces.time_start,
        'time_end', ces.time_end,
        'location_id', ces.location_id,
        'title', ce.title
      ))
      FROM calendar_event_sessions ces
      JOIN calendar_events ce ON ce.id = ces.event_id AND ce.organization_id = ces.organization_id
      WHERE ces.organization_id = v_org_id
        AND ces.session_date = v_date
        AND ces.location_id IS NOT DISTINCT FROM v_location_id
        AND (p_exclude_event_id IS NULL OR ce.id IS DISTINCT FROM p_exclude_event_id)
        AND schedule_time_ranges_overlap(ces.time_start, ces.time_end, v_time_start, v_time_end)
    ), '[]'::jsonb);
  END LOOP;

  RETURN jsonb_build_object('success', true, 'conflicts', v_conflicts);
END;
$$;

CREATE OR REPLACE FUNCTION update_calendar_event_with_cancellations(
  p_event_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_event calendar_events%ROWTYPE;
  v_sessions jsonb;
  v_group_cancels jsonb;
  v_personal_cancels jsonb;
  v_session jsonb;
  v_date date;
  v_time_start text;
  v_time_end text;
  v_location_id uuid;
  v_session_id uuid;
  v_keep_ids uuid[] := ARRAY[]::uuid[];
  v_title text;
  v_event_type text;
  v_income_amount numeric;
  v_slot_id uuid;
  v_lesson_id uuid;
  v_slot schedule_slots%ROWTYPE;
  v_cancel jsonb;
  v_cancel_dates date[];
  v_sorted date[];
  v_conflict_count integer;
  v_selected_group integer;
  v_selected_personal integer;
  v_total_conflicts integer;
  v_group_cancel_count integer := 0;
  v_personal_cancel_count integer := 0;
  v_preview jsonb;
  v_conflict jsonb;
  v_matched integer;
  v_i integer;
  v_j integer;
  v_a jsonb;
  v_b jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.orgReadOnly');
  END IF;

  IF NOT member_can_manage_calendar_events() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.event.forbidden');
  END IF;

  SELECT *
  INTO v_event
  FROM calendar_events ce
  WHERE ce.id = p_event_id
    AND ce.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.event.notFound');
  END IF;

  v_sessions := COALESCE(p_payload -> 'sessions', '[]'::jsonb);
  v_group_cancels := COALESCE(p_payload -> 'group_cancellations', '[]'::jsonb);
  v_personal_cancels := COALESCE(p_payload -> 'personal_cancellations', '[]'::jsonb);

  IF jsonb_typeof(v_sessions) <> 'array' OR jsonb_array_length(v_sessions) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.event.sessionsEmpty');
  END IF;

  v_title := COALESCE(NULLIF(trim(p_payload ->> 'title'), ''), v_event.title);
  v_event_type := COALESCE(p_payload ->> 'event_type', v_event.event_type);

  IF v_event_type NOT IN ('master_class', 'open_lesson') THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.event.typeInvalid');
  END IF;

  v_income_amount := v_event.income_amount;
  IF p_payload ? 'income_amount' THEN
    IF NOT can_read_financial() THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.event.financeForbidden');
    END IF;
    v_income_amount := COALESCE((p_payload ->> 'income_amount')::numeric, 0);
    IF v_income_amount < 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.event.incomeInvalid');
    END IF;
    IF v_event.paid_amount > v_income_amount THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.event.paidExceedsIncome');
    END IF;
  END IF;

  FOR v_i IN 0 .. jsonb_array_length(v_sessions) - 1 LOOP
    FOR v_j IN v_i + 1 .. jsonb_array_length(v_sessions) - 1 LOOP
      v_a := v_sessions -> v_i;
      v_b := v_sessions -> v_j;
      IF (v_a ->> 'date')::date = (v_b ->> 'date')::date
        AND (v_a ->> 'location_id')::uuid IS NOT DISTINCT FROM (v_b ->> 'location_id')::uuid
        AND schedule_time_ranges_overlap(
          normalize_hhmm(v_a ->> 'time_start'),
          normalize_hhmm(v_a ->> 'time_end'),
          normalize_hhmm(v_b ->> 'time_start'),
          normalize_hhmm(v_b ->> 'time_end')
        ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'schedule.event.sessionOverlap');
      END IF;
    END LOOP;
  END LOOP;

  FOR v_session IN SELECT value FROM jsonb_array_elements(v_sessions) LOOP
    v_session_id := NULLIF(v_session ->> 'session_id', '')::uuid;
    v_date := (v_session ->> 'date')::date;
    v_time_start := normalize_hhmm(v_session ->> 'time_start');
    v_time_end := normalize_hhmm(v_session ->> 'time_end');
    v_location_id := (v_session ->> 'location_id')::uuid;

    IF v_time_end <= v_time_start THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.event.sessionInvalid');
    END IF;

    IF v_session_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1
        FROM calendar_event_sessions ces
        WHERE ces.id = v_session_id
          AND ces.event_id = p_event_id
          AND ces.organization_id = v_org_id
      ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'schedule.event.sessionNotFound');
      END IF;
      v_keep_ids := array_append(v_keep_ids, v_session_id);
    END IF;
  END LOOP;

  v_preview := preview_calendar_event_conflicts(v_sessions, p_event_id);
  IF NOT COALESCE((v_preview ->> 'success')::boolean, false) THEN
    RETURN v_preview;
  END IF;

  v_total_conflicts := jsonb_array_length(COALESCE(v_preview -> 'conflicts', '[]'::jsonb));
  v_selected_group := jsonb_array_length(v_group_cancels);
  v_selected_personal := jsonb_array_length(v_personal_cancels);

  IF v_selected_group + v_selected_personal <> v_total_conflicts THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.event.unresolvedConflicts');
  END IF;

  FOR v_conflict IN SELECT value FROM jsonb_array_elements(COALESCE(v_preview -> 'conflicts', '[]'::jsonb)) LOOP
    IF v_conflict ->> 'kind' = 'group' THEN
      SELECT count(*)
      INTO v_matched
      FROM jsonb_array_elements(v_group_cancels) AS elem
      WHERE (elem ->> 'slot_id')::uuid = (v_conflict ->> 'slot_id')::uuid
        AND (elem ->> 'date')::date = (v_conflict ->> 'occurrence_date')::date;

      IF v_matched = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'schedule.event.unresolvedConflicts');
      END IF;
    ELSIF v_conflict ->> 'kind' = 'personal' THEN
      SELECT count(*)
      INTO v_matched
      FROM jsonb_array_elements(v_personal_cancels) AS elem
      WHERE (elem ->> 'lesson_id')::uuid = (v_conflict ->> 'lesson_id')::uuid;

      IF v_matched = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'schedule.event.unresolvedConflicts');
      END IF;
    ELSIF v_conflict ->> 'kind' = 'event' THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.event.eventConflict');
    END IF;
  END LOOP;

  FOR v_slot_id IN
    SELECT DISTINCT (elem ->> 'slot_id')::uuid
    FROM jsonb_array_elements(v_group_cancels) AS elem
  LOOP
    IF NOT member_can_write_schedule_slot(v_slot_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.error.cancelForbidden');
    END IF;

    SELECT array_agg((elem ->> 'date')::date ORDER BY (elem ->> 'date')::date)
    INTO v_cancel_dates
    FROM jsonb_array_elements(v_group_cancels) AS elem
    WHERE (elem ->> 'slot_id')::uuid = v_slot_id;

    SELECT *
    INTO v_slot
    FROM schedule_slots ss
    WHERE ss.id = v_slot_id
      AND ss.organization_id = v_org_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.error.slotNotFound');
    END IF;

    SELECT count(*)
    INTO v_conflict_count
    FROM unnest(v_cancel_dates) AS d
    WHERE _is_group_slot_occurrence_date(v_slot, d);

    IF v_conflict_count <> array_length(v_cancel_dates, 1) THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.error.cancelDateInvalid');
    END IF;
  END LOOP;

  FOR v_cancel IN SELECT value FROM jsonb_array_elements(v_personal_cancels) LOOP
    v_lesson_id := (v_cancel ->> 'lesson_id')::uuid;
    IF NOT member_can_cancel_personal_lesson(v_lesson_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.event.personalCancelForbidden');
    END IF;
  END LOOP;

  FOR v_slot_id IN
    SELECT DISTINCT (elem ->> 'slot_id')::uuid
    FROM jsonb_array_elements(v_group_cancels) AS elem
  LOOP
    SELECT *
    INTO v_slot
    FROM schedule_slots ss
    WHERE ss.id = v_slot_id
      AND ss.organization_id = v_org_id
    FOR UPDATE;

    SELECT array_agg((elem ->> 'date')::date ORDER BY (elem ->> 'date')::date)
    INTO v_cancel_dates
    FROM jsonb_array_elements(v_group_cancels) AS elem
    WHERE (elem ->> 'slot_id')::uuid = v_slot_id;

    SELECT array_agg(d ORDER BY d)
    INTO v_sorted
    FROM unnest(v_cancel_dates) AS d;

    PERFORM _record_schedule_cancellations(v_slot, v_sorted);
    v_group_cancel_count := v_group_cancel_count + _apply_group_slot_cancellations_locked(v_slot_id, v_sorted);
  END LOOP;

  FOR v_cancel IN SELECT value FROM jsonb_array_elements(v_personal_cancels) LOOP
    v_lesson_id := (v_cancel ->> 'lesson_id')::uuid;

    UPDATE personal_lessons pl
    SET
      cancelled_at = now(),
      cancelled_reason = COALESCE(NULLIF(trim(v_cancel ->> 'reason'), ''), 'calendar_event'),
      cancelled_by = v_member_id
    WHERE pl.id = v_lesson_id
      AND pl.organization_id = v_org_id
      AND pl.cancelled_at IS NULL;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.event.personalNotFound');
    END IF;

    v_personal_cancel_count := v_personal_cancel_count + 1;
  END LOOP;

  UPDATE calendar_events
  SET
    title = v_title,
    event_type = v_event_type,
    comment = CASE
      WHEN p_payload ? 'comment' THEN NULLIF(trim(p_payload ->> 'comment'), '')
      ELSE comment
    END,
    guest_teacher = CASE
      WHEN p_payload ? 'guest_teacher' THEN NULLIF(trim(p_payload ->> 'guest_teacher'), '')
      ELSE guest_teacher
    END,
    organizer = CASE
      WHEN p_payload ? 'organizer' THEN NULLIF(trim(p_payload ->> 'organizer'), '')
      ELSE organizer
    END,
    planned_guest_count = CASE
      WHEN p_payload ? 'planned_guest_count' THEN (p_payload ->> 'planned_guest_count')::integer
      ELSE planned_guest_count
    END,
    actual_guest_count = CASE
      WHEN p_payload ? 'actual_guest_count' THEN (p_payload ->> 'actual_guest_count')::integer
      ELSE actual_guest_count
    END,
    income_amount = v_income_amount,
    payment_comment = CASE
      WHEN p_payload ? 'payment_comment' AND can_read_financial()
        THEN NULLIF(trim(p_payload ->> 'payment_comment'), '')
      ELSE payment_comment
    END,
    payment_status = _calendar_event_payment_status(v_income_amount, paid_amount),
    updated_at = now()
  WHERE id = p_event_id;

  DELETE FROM calendar_event_sessions ces
  WHERE ces.event_id = p_event_id
    AND ces.organization_id = v_org_id
    AND NOT (ces.id = ANY (v_keep_ids));

  FOR v_session IN SELECT value FROM jsonb_array_elements(v_sessions) LOOP
    v_session_id := NULLIF(v_session ->> 'session_id', '')::uuid;
    v_date := (v_session ->> 'date')::date;
    v_time_start := normalize_hhmm(v_session ->> 'time_start');
    v_time_end := normalize_hhmm(v_session ->> 'time_end');
    v_location_id := (v_session ->> 'location_id')::uuid;

    IF schedule_location_has_conflict(
      v_org_id, v_date, v_time_start, v_time_end, v_location_id, NULL, p_event_id
    ) THEN
      RAISE EXCEPTION 'schedule.event.slotConflict' USING ERRCODE = 'P0001';
    END IF;

    IF v_session_id IS NOT NULL THEN
      UPDATE calendar_event_sessions ces
      SET
        session_date = v_date,
        time_start = v_time_start,
        time_end = v_time_end,
        location_id = v_location_id
      WHERE ces.id = v_session_id
        AND ces.event_id = p_event_id
        AND ces.organization_id = v_org_id;
    ELSE
      INSERT INTO calendar_event_sessions (
        organization_id,
        event_id,
        session_date,
        time_start,
        time_end,
        location_id
      )
      VALUES (
        v_org_id,
        p_event_id,
        v_date,
        v_time_start,
        v_time_end,
        v_location_id
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'session_count', jsonb_array_length(v_sessions),
    'group_cancel_count', v_group_cancel_count,
    'personal_cancel_count', v_personal_cancel_count
  );
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION preview_calendar_event_conflicts(jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION preview_calendar_event_conflicts(jsonb, uuid) TO authenticated;

REVOKE ALL ON FUNCTION update_calendar_event_with_cancellations(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_calendar_event_with_cancellations(uuid, jsonb) TO authenticated;

COMMIT;
