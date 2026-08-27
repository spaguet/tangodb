-- S23 / M38+M42+M47+M50: preview conflicts without foreign client PII; teacher-scoped rentals and GCal labels.

BEGIN;

-- =============================================================================
-- 1. M38 — preview_rental_conflicts: mask client_display for accountant/foreign teacher
-- =============================================================================

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
      AND s.valid_from <= p_date
      AND (s.valid_to IS NULL OR s.valid_to >= p_date)
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

-- =============================================================================
-- 2. M42 — preview_calendar_event_conflicts: accountant allowed; mask foreign client_display
-- =============================================================================

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

-- =============================================================================
-- 3. M47 — get_rentals_for_schedule_week: teacher location scope / full-schedule flag
-- =============================================================================

CREATE OR REPLACE FUNCTION get_rentals_for_schedule_week(
  p_week_start date,
  p_week_end date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_sensitive boolean;
  v_rows jsonb;
  v_teacher_full_schedule boolean;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  IF NOT can_read_operational() AND current_member_role() <> 'teacher' THEN
    RETURN '[]'::jsonb;
  END IF;

  v_sensitive := member_can_see_rental_sensitive();

  IF current_member_role() = 'teacher' THEN
    SELECT COALESCE(os.teachers_can_view_full_schedule, true)
    INTO v_teacher_full_schedule
    FROM organization_settings os
    WHERE os.organization_id = v_org_id;
    v_teacher_full_schedule := COALESCE(v_teacher_full_schedule, true);
  ELSE
    v_teacher_full_schedule := true;
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.rental_date, x.time_start), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      r.id AS rental_id,
      r.rental_date,
      r.time_start,
      r.time_end,
      r.location_id,
      r.rental_series_id,
      r.booking_status,
      CASE WHEN v_sensitive THEN r.purpose ELSE NULL END AS purpose,
      CASE WHEN v_sensitive THEN ren.display_name ELSE NULL END AS renter_name,
      CASE WHEN v_sensitive THEN _rental_effective_amount(r.fixed_amount, r.final_amount) ELSE NULL END AS fixed_amount,
      CASE WHEN v_sensitive THEN r.currency ELSE NULL END AS currency,
      CASE WHEN v_sensitive THEN _rental_paid_total(r.id, r.organization_id) ELSE NULL END AS paid_amount,
      CASE WHEN v_sensitive THEN _rental_payment_status(
        _rental_effective_amount(r.fixed_amount, r.final_amount),
        _rental_paid_total(r.id, r.organization_id)
      ) ELSE NULL END AS payment_status
    FROM rentals r
    JOIN renters ren ON ren.id = r.renter_id AND ren.organization_id = r.organization_id
    WHERE r.organization_id = v_org_id
      AND r.rental_date >= p_week_start
      AND r.rental_date <= p_week_end
      AND (
        current_member_role() <> 'teacher'
        OR v_teacher_full_schedule
        OR teacher_has_location_access(r.location_id)
      )
  ) x;

  RETURN v_rows;
END;
$$;

-- =============================================================================
-- 4. M50 — get_schedule_calendar_sync_labels: teacher only own lessons/slots
-- =============================================================================

CREATE OR REPLACE FUNCTION get_schedule_calendar_sync_labels(
  p_date_from date,
  p_date_to date
)
RETURNS TABLE (
  source_type text,
  source_id uuid,
  occurrence_date date,
  calendar_name text,
  sync_status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_filter_teacher boolean := current_member_role() = 'teacher';
  v_member_id uuid := auth_member_id();
BEGIN
  IF v_org_id IS NULL OR NOT business_row_readable() THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH linked AS (
    SELECT DISTINCT ON (l.source_type, l.source_id, l.occurrence_date)
      l.source_type,
      l.source_id,
      l.occurrence_date,
      COALESCE(mb.calendar_name, ob.calendar_name) AS calendar_name,
      l.sync_status
    FROM google_calendar_event_links l
    LEFT JOIN member_google_calendar_bindings mb
      ON mb.id = l.member_binding_id
     AND mb.organization_id = l.organization_id
    LEFT JOIN organization_google_calendar_bindings ob
      ON ob.id = l.organization_binding_id
     AND ob.organization_id = l.organization_id
    WHERE l.organization_id = v_org_id
      AND l.occurrence_date BETWEEN p_date_from AND p_date_to
      AND l.sync_status <> 'detached'
      AND COALESCE(mb.calendar_name, ob.calendar_name) IS NOT NULL
      AND (
        NOT v_filter_teacher
        OR l.source_type = 'event_session'
        OR (
          l.source_type = 'personal_lesson'
          AND EXISTS (
            SELECT 1
            FROM personal_lessons pl
            WHERE pl.organization_id = v_org_id
              AND pl.id = l.source_id
              AND pl.teacher_member_id IS NOT DISTINCT FROM v_member_id
          )
        )
        OR (
          l.source_type = 'group_occurrence'
          AND EXISTS (
            SELECT 1
            FROM schedule_slots ss
            WHERE ss.organization_id = v_org_id
              AND ss.id = l.source_id
              AND ss.teacher_member_id IS NOT DISTINCT FROM v_member_id
          )
        )
      )
    ORDER BY l.source_type, l.source_id, l.occurrence_date, l.updated_at DESC
  ),
  personal_binding AS (
    SELECT
      'personal_lesson'::text AS source_type,
      pl.id AS source_id,
      pl.date AS occurrence_date,
      b.calendar_name,
      NULL::text AS sync_status
    FROM personal_lessons pl
    JOIN member_google_calendar_bindings b
      ON b.organization_id = pl.organization_id
     AND b.organization_member_id = pl.teacher_member_id
     AND b.enabled = true
     AND b.sync_personal = true
    JOIN organization_members om
      ON om.id = b.organization_member_id
     AND om.organization_id = b.organization_id
     AND om.is_active = true
    WHERE pl.organization_id = v_org_id
      AND pl.date BETWEEN p_date_from AND p_date_to
      AND pl.teacher_member_id IS NOT NULL
      AND (NOT v_filter_teacher OR pl.teacher_member_id IS NOT DISTINCT FROM v_member_id)
      AND NOT EXISTS (
        SELECT 1
        FROM linked l
        WHERE l.source_type = 'personal_lesson'
          AND l.source_id = pl.id
      )
  ),
  group_binding AS (
    SELECT
      'group_occurrence'::text AS source_type,
      ss.id AS source_id,
      d.occurrence_date::date AS occurrence_date,
      b.calendar_name,
      NULL::text AS sync_status
    FROM schedule_slots ss
    CROSS JOIN generate_series(p_date_from, p_date_to, interval '1 day') AS d(occurrence_date)
    JOIN member_google_calendar_bindings b
      ON b.organization_id = ss.organization_id
     AND b.organization_member_id = ss.teacher_member_id
     AND b.enabled = true
     AND b.sync_group = true
    JOIN organization_members om
      ON om.id = b.organization_member_id
     AND om.organization_id = b.organization_id
     AND om.is_active = true
    WHERE ss.organization_id = v_org_id
      AND ss.teacher_member_id IS NOT NULL
      AND (NOT v_filter_teacher OR ss.teacher_member_id IS NOT DISTINCT FROM v_member_id)
      AND EXTRACT(ISODOW FROM d.occurrence_date)::int = ss.day_of_week
      AND ss.valid_from::date <= d.occurrence_date::date
      AND (ss.valid_to IS NULL OR ss.valid_to::date >= d.occurrence_date::date)
      AND NOT EXISTS (
        SELECT 1
        FROM linked l
        WHERE l.source_type = 'group_occurrence'
          AND l.source_id = ss.id
          AND l.occurrence_date = d.occurrence_date::date
      )
      AND NOT EXISTS (
        SELECT 1
        FROM schedule_occurrence_cancellations soc
        WHERE soc.organization_id = ss.organization_id
          AND soc.slot_id = ss.id
          AND soc.occurrence_date = d.occurrence_date::date
      )
  ),
  event_binding AS (
    SELECT
      'event_session'::text AS source_type,
      ces.id AS source_id,
      ces.session_date AS occurrence_date,
      ob.calendar_name,
      NULL::text AS sync_status
    FROM calendar_event_sessions ces
    JOIN organization_google_calendar_bindings ob
      ON ob.organization_id = ces.organization_id
     AND ob.enabled = true
    WHERE ces.organization_id = v_org_id
      AND ces.session_date BETWEEN p_date_from AND p_date_to
      AND NOT EXISTS (
        SELECT 1
        FROM linked l
        WHERE l.source_type = 'event_session'
          AND l.source_id = ces.id
          AND l.occurrence_date = ces.session_date
      )
  )
  SELECT linked.source_type, linked.source_id, linked.occurrence_date, linked.calendar_name, linked.sync_status
  FROM linked
  UNION ALL
  SELECT personal_binding.source_type, personal_binding.source_id, personal_binding.occurrence_date, personal_binding.calendar_name, personal_binding.sync_status
  FROM personal_binding
  UNION ALL
  SELECT group_binding.source_type, group_binding.source_id, group_binding.occurrence_date, group_binding.calendar_name, group_binding.sync_status
  FROM group_binding
  UNION ALL
  SELECT event_binding.source_type, event_binding.source_id, event_binding.occurrence_date, event_binding.calendar_name, event_binding.sync_status
  FROM event_binding;
END;
$$;

REVOKE ALL ON FUNCTION preview_calendar_event_conflicts(jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION preview_calendar_event_conflicts(jsonb, uuid) TO authenticated;

COMMIT;
