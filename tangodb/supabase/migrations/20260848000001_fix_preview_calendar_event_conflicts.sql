-- Restore preview_calendar_event_conflicts(jsonb, uuid) after hall_rentals reintroduced
-- a single-arg overload. Client RPC always sends p_exclude_event_id; PostgREST may fail
-- to resolve the overload. Also skip already-cancelled group occurrences.

BEGIN;

DROP FUNCTION IF EXISTS preview_calendar_event_conflicts(jsonb);
DROP FUNCTION IF EXISTS preview_calendar_event_conflicts(jsonb, uuid);

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
        AND NOT EXISTS (
          SELECT 1
          FROM schedule_occurrence_cancellations soc
          WHERE soc.organization_id = v_org_id
            AND soc.slot_id = s.id
            AND soc.occurrence_date = v_date
        )
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

    v_conflicts := v_conflicts || COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'kind', 'rental',
        'rental_id', r.id,
        'occurrence_date', r.rental_date,
        'time_start', r.time_start,
        'time_end', r.time_end,
        'location_id', r.location_id,
        'purpose', COALESCE(r.purpose, '')
      ))
      FROM rentals r
      WHERE r.organization_id = v_org_id
        AND r.rental_date = v_date
        AND r.location_id IS NOT DISTINCT FROM v_location_id
        AND r.booking_status = 'confirmed'
        AND schedule_time_ranges_overlap(r.time_start, r.time_end, v_time_start, v_time_end)
    ), '[]'::jsonb);
  END LOOP;

  RETURN jsonb_build_object('success', true, 'conflicts', v_conflicts);
END;
$$;

REVOKE ALL ON FUNCTION preview_calendar_event_conflicts(jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION preview_calendar_event_conflicts(jsonb, uuid) TO authenticated;

COMMIT;
