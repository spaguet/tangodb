-- Retired group slots (valid_to <= valid_from) must not block rentals from the delete date.
-- Align occupancy checks with expandSlotsToWeek / isRetiredScheduleSlot in the CRM schedule grid.

BEGIN;

CREATE OR REPLACE FUNCTION _schedule_slot_active_on_date(
  p_valid_from date,
  p_valid_to date,
  p_date date
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(p_valid_from, DATE '2000-01-01') <= p_date
     AND (p_valid_to IS NULL OR p_valid_to > COALESCE(p_valid_from, DATE '2000-01-01'))
     AND (p_valid_to IS NULL OR p_date <= p_valid_to);
$$;

COMMENT ON FUNCTION _schedule_slot_active_on_date(date, date, date) IS
  'True when a schedule_slots row occupies p_date (excludes retired tombstones valid_to <= valid_from).';

CREATE OR REPLACE FUNCTION preview_rental_conflicts(
  p_date date,
  p_time_start text,
  p_time_end text,
  p_location_id uuid,
  p_exclude_rental_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_time_start text;
  v_time_end text;
  v_dow integer;
  v_conflicts jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT (
    can_read_operational()
    OR current_member_role() = 'teacher'
    OR can_read_financial()
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF p_date IS NULL OR p_time_start IS NULL OR p_time_end IS NULL OR p_location_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.fieldsInvalid');
  END IF;

  v_time_start := normalize_hhmm(p_time_start);
  v_time_end := normalize_hhmm(p_time_end);
  v_dow := EXTRACT(ISODOW FROM p_date)::integer;

  IF _hhmm_to_minutes(v_time_end) <= _hhmm_to_minutes(v_time_start) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.timeRangeInvalid');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM locations l
    WHERE l.id = p_location_id AND l.organization_id = v_org_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.locationInvalid');
  END IF;

  IF NOT teacher_can_view_schedule_location(p_location_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  v_conflicts := v_conflicts || COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'kind', 'group',
      'slot_id', s.id,
      'occurrence_date', p_date,
      'time_start', s.time,
      'time_end', s.time_end,
      'location_id', s.location_id,
      'group_name', COALESCE(s.group_name, '')
    ))
    FROM schedule_slots s
    WHERE s.organization_id = v_org_id
      AND s.day_of_week = v_dow
      AND s.location_id IS NOT DISTINCT FROM p_location_id
      AND _schedule_slot_active_on_date(s.valid_from, s.valid_to, p_date)
      AND schedule_time_ranges_overlap(s.time, s.time_end, v_time_start, v_time_end)
      AND NOT EXISTS (
        SELECT 1
        FROM schedule_occurrence_cancellations soc
        WHERE soc.organization_id = v_org_id
          AND soc.slot_id = s.id
          AND soc.occurrence_date = p_date
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
      'client_display', CASE
        WHEN can_read_operational() THEN COALESCE(
          NULLIF(trim(concat_ws(' ', c1.first_name, c1.last_name)), ''),
          ''
        )
        WHEN current_member_role() = 'teacher'
          AND p.teacher_member_id IS NOT DISTINCT FROM auth_member_id()
        THEN COALESCE(
          NULLIF(trim(concat_ws(' ', c1.first_name, c1.last_name)), ''),
          ''
        )
        ELSE ''
      END
    ))
    FROM personal_lessons p
    LEFT JOIN clients c1
      ON c1.organization_id = p.organization_id AND c1.id = p.client_id1
    WHERE p.organization_id = v_org_id
      AND p.date = p_date
      AND p.cancelled_at IS NULL
      AND p.location_id IS NOT DISTINCT FROM p_location_id
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
      AND ces.session_date = p_date
      AND ces.location_id IS NOT DISTINCT FROM p_location_id
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
      AND r.rental_date = p_date
      AND r.location_id IS NOT DISTINCT FROM p_location_id
      AND r.booking_status = 'confirmed'
      AND r.id IS DISTINCT FROM p_exclude_rental_id
      AND schedule_time_ranges_overlap(r.time_start, r.time_end, v_time_start, v_time_end)
  ), '[]'::jsonb);

  RETURN jsonb_build_object('success', true, 'conflicts', v_conflicts);
END;
$$;

CREATE OR REPLACE FUNCTION _renter_location_slot_busy(
  p_org_id uuid,
  p_date date,
  p_time_start text,
  p_time_end text,
  p_location_id uuid,
  p_exclude_rental_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_time_start text;
  v_time_end text;
  v_dow integer;
BEGIN
  v_time_start := normalize_hhmm(p_time_start);
  v_time_end := normalize_hhmm(p_time_end);

  IF _hhmm_to_minutes(v_time_end) <= _hhmm_to_minutes(v_time_start) THEN
    RETURN true;
  END IF;

  v_dow := EXTRACT(ISODOW FROM p_date)::integer;

  IF EXISTS (
    SELECT 1
    FROM personal_lessons p
    WHERE p.organization_id = p_org_id
      AND p.date = p_date
      AND p.cancelled_at IS NULL
      AND p.location_id IS NOT DISTINCT FROM p_location_id
      AND schedule_time_ranges_overlap(p.time_start, p.time_end, v_time_start, v_time_end)
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM schedule_slots s
    WHERE s.organization_id = p_org_id
      AND s.day_of_week = v_dow
      AND s.location_id IS NOT DISTINCT FROM p_location_id
      AND _schedule_slot_active_on_date(s.valid_from, s.valid_to, p_date)
      AND schedule_time_ranges_overlap(s.time, s.time_end, v_time_start, v_time_end)
      AND NOT EXISTS (
        SELECT 1
        FROM schedule_occurrence_cancellations soc
        WHERE soc.organization_id = p_org_id
          AND soc.slot_id = s.id
          AND soc.occurrence_date = p_date
      )
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM calendar_event_sessions ces
    JOIN calendar_events ce ON ce.id = ces.event_id AND ce.organization_id = ces.organization_id
    WHERE ces.organization_id = p_org_id
      AND ces.session_date = p_date
      AND ces.location_id IS NOT DISTINCT FROM p_location_id
      AND schedule_time_ranges_overlap(ces.time_start, ces.time_end, v_time_start, v_time_end)
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM rentals r
    WHERE r.organization_id = p_org_id
      AND r.rental_date = p_date
      AND r.location_id IS NOT DISTINCT FROM p_location_id
      AND r.booking_status = 'confirmed'
      AND r.id IS DISTINCT FROM p_exclude_rental_id
      AND schedule_time_ranges_overlap(r.time_start, r.time_end, v_time_start, v_time_end)
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

COMMENT ON FUNCTION _renter_location_slot_busy(uuid, date, text, text, uuid, uuid) IS
  'Occupancy predicate: active group/personal/event/rental confirmed; excludes retired slots and cancelled group occurrences.';

-- Patch only the group-slot predicate inside preview_calendar_event_conflicts (full body unchanged otherwise).
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

  IF NOT (
    can_read_operational()
    OR current_member_role() = 'teacher'
    OR can_read_financial()
  ) THEN
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

    IF NOT teacher_can_view_schedule_location(v_location_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
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
        AND _schedule_slot_active_on_date(s.valid_from, s.valid_to, v_date)
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
        'client_display', CASE
          WHEN can_read_operational() THEN COALESCE(p.client_display, '')
          WHEN current_member_role() = 'teacher'
            AND p.teacher_member_id IS NOT DISTINCT FROM auth_member_id()
          THEN COALESCE(p.client_display, '')
          ELSE ''
        END,
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

COMMIT;
