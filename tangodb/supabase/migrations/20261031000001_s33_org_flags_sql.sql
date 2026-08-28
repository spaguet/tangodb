-- S33 / M21: remaining §9 org flags in SQL (not already closed by S07–S20 / S09 / S23).
-- teachers_can_sell_personal_lessons: already S09 (teacher_can_write_personal_lessons + INSERT).
-- This migration: admin_can_manage_team in can_manage_team(); teachers_can_view_full_schedule
-- on own-vs-full schedule access + occupancy RPCs neighboring get_rentals (S23).

BEGIN;

-- =============================================================================
-- 1. Helpers
-- =============================================================================

CREATE OR REPLACE FUNCTION admin_can_manage_team_setting()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    (
      SELECT os.admin_can_manage_team
      FROM organization_settings os
      WHERE os.organization_id = auth_organization_id()
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION teachers_can_view_full_schedule_setting()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    (
      SELECT os.teachers_can_view_full_schedule
      FROM organization_settings os
      WHERE os.organization_id = auth_organization_id()
    ),
    true
  );
$$;

-- Non-teacher, or flag on, or location in JWT scope (S23 occupancy semantics).
CREATE OR REPLACE FUNCTION teacher_can_view_schedule_location(p_location_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    current_member_role() IS DISTINCT FROM 'teacher'
    OR teachers_can_view_full_schedule_setting()
    OR teacher_has_location_access(p_location_id);
$$;

REVOKE ALL ON FUNCTION admin_can_manage_team_setting() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION teachers_can_view_full_schedule_setting() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION teacher_can_view_schedule_location(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_can_manage_team_setting() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION teachers_can_view_full_schedule_setting() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION teacher_can_view_schedule_location(uuid) TO authenticated, service_role;

-- =============================================================================
-- 2. can_manage_team: owner/director, or admin with org flag; never reception
-- =============================================================================

CREATE OR REPLACE FUNCTION can_manage_team()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT
    NOT is_restricted_admin()
    AND (
      current_member_role() IN ('owner', 'director')
      OR (
        current_member_role() = 'admin'
        AND admin_can_manage_team_setting()
      )
    );
$$;

-- =============================================================================
-- 3. teachers_can_view_full_schedule: flag off → only own teacher_member_id
-- =============================================================================

CREATE OR REPLACE FUNCTION teacher_can_access_lesson(p_lesson_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_lesson RECORD;
BEGIN
  SELECT pl.discipline_id, pl.location_id, pl.teacher_member_id
  INTO v_lesson
  FROM personal_lessons pl
  WHERE pl.id = p_lesson_id
    AND pl.organization_id = auth_organization_id();

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_lesson.teacher_member_id = auth_member_id() THEN
    RETURN true;
  END IF;

  IF NOT teachers_can_view_full_schedule_setting() THEN
    RETURN false;
  END IF;

  IF NOT teacher_has_discipline_access(v_lesson.discipline_id) THEN
    RETURN false;
  END IF;

  IF v_lesson.location_id IS NOT NULL
    AND NOT teacher_has_location_access(v_lesson.location_id) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION teacher_can_access_schedule_slot(p_slot_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_slot RECORD;
BEGIN
  SELECT ss.discipline_id, ss.location_id, ss.teacher_member_id
  INTO v_slot
  FROM schedule_slots ss
  WHERE ss.id = p_slot_id
    AND ss.organization_id = auth_organization_id();

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_slot.teacher_member_id = auth_member_id() THEN
    RETURN true;
  END IF;

  IF NOT teachers_can_view_full_schedule_setting() THEN
    RETURN false;
  END IF;

  IF v_slot.discipline_id IS NOT NULL
    AND NOT teacher_has_discipline_access(v_slot.discipline_id) THEN
    RETURN false;
  END IF;

  IF v_slot.location_id IS NOT NULL
    AND NOT teacher_has_location_access(v_slot.location_id) THEN
    RETURN false;
  END IF;

  IF v_slot.discipline_id IS NULL AND v_slot.location_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

-- =============================================================================
-- 4. Occupancy RPCs neighboring get_rentals (S23): location scope when flag off
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
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  IF NOT can_read_operational() AND current_member_role() <> 'teacher' THEN
    RETURN '[]'::jsonb;
  END IF;

  v_sensitive := member_can_see_rental_sensitive();

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
      AND teacher_can_view_schedule_location(r.location_id)
  ) x;

  RETURN v_rows;
END;
$$;

-- =============================================================================
-- 5. Calendar events / sessions: teacher without full-schedule → location scope
-- =============================================================================

DROP VIEW IF EXISTS calendar_events_teacher_v;

CREATE VIEW calendar_events_teacher_v
WITH (security_invoker = false) AS
SELECT
  ce.id,
  ce.organization_id,
  ce.title,
  ce.event_type,
  ce.comment,
  ce.guest_teacher,
  ce.organizer,
  ce.planned_guest_count
FROM calendar_events ce
WHERE ce.organization_id = auth_organization_id()
  AND business_row_readable()
  AND current_member_role() = 'teacher'
  AND (
    teachers_can_view_full_schedule_setting()
    OR EXISTS (
      SELECT 1
      FROM calendar_event_sessions ces
      WHERE ces.event_id = ce.id
        AND ces.organization_id = ce.organization_id
        AND teacher_has_location_access(ces.location_id)
    )
  );

GRANT SELECT ON calendar_events_teacher_v TO authenticated;

DROP POLICY IF EXISTS calendar_event_sessions_select_teacher ON calendar_event_sessions;

CREATE POLICY calendar_event_sessions_select_teacher
  ON calendar_event_sessions FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND current_member_role() = 'teacher'
    AND teacher_can_view_schedule_location(location_id)
  );

COMMIT;
