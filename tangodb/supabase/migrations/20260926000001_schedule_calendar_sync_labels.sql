-- Schedule grid: calendar name labels for Google Calendar sync (personal / group / events)

BEGIN;

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

REVOKE ALL ON FUNCTION get_schedule_calendar_sync_labels(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_schedule_calendar_sync_labels(date, date) TO authenticated;

COMMIT;
