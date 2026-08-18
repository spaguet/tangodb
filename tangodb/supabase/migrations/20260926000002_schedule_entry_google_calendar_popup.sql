-- Popup: calendar name + sync status for personal lessons and group occurrences

BEGIN;

DROP FUNCTION IF EXISTS get_personal_lesson_google_sync_status(uuid);

CREATE OR REPLACE FUNCTION get_personal_lesson_google_sync_status(p_lesson_id uuid)
RETURNS TABLE (
  sync_status text,
  last_synced_at timestamptz,
  last_error text,
  has_pending_job boolean,
  teacher_has_binding boolean,
  calendar_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_teacher_member_id uuid;
BEGIN
  IF v_org_id IS NULL OR NOT business_row_readable() THEN
    RETURN;
  END IF;

  IF NOT (
    can_read_all_business()
    OR (current_member_role() = 'teacher' AND teacher_can_access_lesson(p_lesson_id))
  ) THEN
    RETURN;
  END IF;

  SELECT pl.teacher_member_id
  INTO v_teacher_member_id
  FROM personal_lessons pl
  WHERE pl.id = p_lesson_id
    AND pl.organization_id = v_org_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH link_row AS (
    SELECT
      l.sync_status,
      l.last_synced_at,
      l.last_error,
      mb.calendar_name AS link_calendar_name
    FROM google_calendar_event_links l
    LEFT JOIN member_google_calendar_bindings mb
      ON mb.id = l.member_binding_id
     AND mb.organization_id = l.organization_id
    WHERE l.organization_id = v_org_id
      AND l.source_type = 'personal_lesson'
      AND l.source_id = p_lesson_id
    ORDER BY l.updated_at DESC
    LIMIT 1
  ),
  pending_job AS (
    SELECT EXISTS (
      SELECT 1
      FROM calendar_sync_outbox o
      WHERE o.organization_id = v_org_id
        AND o.source_type = 'personal_lesson'
        AND o.source_id = p_lesson_id
        AND o.status IN ('pending', 'retry', 'processing')
    ) AS has_pending_job
  ),
  teacher_binding AS (
    SELECT
      EXISTS (
        SELECT 1
        FROM member_google_calendar_bindings b
        JOIN organization_members om
          ON om.id = b.organization_member_id
         AND om.organization_id = b.organization_id
        WHERE b.organization_id = v_org_id
          AND b.organization_member_id = v_teacher_member_id
          AND b.enabled = true
          AND b.sync_personal = true
          AND om.is_active = true
          AND v_teacher_member_id IS NOT NULL
      ) AS teacher_has_binding,
      (
        SELECT b.calendar_name
        FROM member_google_calendar_bindings b
        JOIN organization_members om
          ON om.id = b.organization_member_id
         AND om.organization_id = b.organization_id
        WHERE b.organization_id = v_org_id
          AND b.organization_member_id = v_teacher_member_id
          AND b.enabled = true
          AND b.sync_personal = true
          AND om.is_active = true
          AND v_teacher_member_id IS NOT NULL
        LIMIT 1
      ) AS binding_calendar_name
  )
  SELECT
    lr.sync_status,
    lr.last_synced_at,
    lr.last_error,
    COALESCE(pj.has_pending_job, false),
    COALESCE(tb.teacher_has_binding, false),
    COALESCE(lr.link_calendar_name, tb.binding_calendar_name)
  FROM teacher_binding tb
  CROSS JOIN pending_job pj
  LEFT JOIN link_row lr ON true;
END;
$$;

CREATE OR REPLACE FUNCTION get_group_occurrence_google_sync_status(
  p_slot_id uuid,
  p_occurrence_date date
)
RETURNS TABLE (
  sync_status text,
  last_synced_at timestamptz,
  last_error text,
  has_pending_job boolean,
  teacher_has_binding boolean,
  calendar_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_teacher_member_id uuid;
BEGIN
  IF v_org_id IS NULL OR NOT business_row_readable() THEN
    RETURN;
  END IF;

  SELECT ss.teacher_member_id
  INTO v_teacher_member_id
  FROM schedule_slots ss
  WHERE ss.id = p_slot_id
    AND ss.organization_id = v_org_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH link_row AS (
    SELECT
      l.sync_status,
      l.last_synced_at,
      l.last_error,
      mb.calendar_name AS link_calendar_name
    FROM google_calendar_event_links l
    LEFT JOIN member_google_calendar_bindings mb
      ON mb.id = l.member_binding_id
     AND mb.organization_id = l.organization_id
    WHERE l.organization_id = v_org_id
      AND l.source_type = 'group_occurrence'
      AND l.source_id = p_slot_id
      AND l.occurrence_date = p_occurrence_date
    ORDER BY l.updated_at DESC
    LIMIT 1
  ),
  pending_job AS (
    SELECT EXISTS (
      SELECT 1
      FROM calendar_sync_outbox o
      WHERE o.organization_id = v_org_id
        AND o.source_type = 'group_occurrence'
        AND o.source_id = p_slot_id
        AND o.occurrence_date = p_occurrence_date
        AND o.status IN ('pending', 'retry', 'processing')
    ) AS has_pending_job
  ),
  teacher_binding AS (
    SELECT
      EXISTS (
        SELECT 1
        FROM member_google_calendar_bindings b
        JOIN organization_members om
          ON om.id = b.organization_member_id
         AND om.organization_id = b.organization_id
        WHERE b.organization_id = v_org_id
          AND b.organization_member_id = v_teacher_member_id
          AND b.enabled = true
          AND b.sync_group = true
          AND om.is_active = true
          AND v_teacher_member_id IS NOT NULL
      ) AS teacher_has_binding,
      (
        SELECT b.calendar_name
        FROM member_google_calendar_bindings b
        JOIN organization_members om
          ON om.id = b.organization_member_id
         AND om.organization_id = b.organization_id
        WHERE b.organization_id = v_org_id
          AND b.organization_member_id = v_teacher_member_id
          AND b.enabled = true
          AND b.sync_group = true
          AND om.is_active = true
          AND v_teacher_member_id IS NOT NULL
        LIMIT 1
      ) AS binding_calendar_name
  )
  SELECT
    lr.sync_status,
    lr.last_synced_at,
    lr.last_error,
    COALESCE(pj.has_pending_job, false),
    COALESCE(tb.teacher_has_binding, false),
    COALESCE(lr.link_calendar_name, tb.binding_calendar_name)
  FROM teacher_binding tb
  CROSS JOIN pending_job pj
  LEFT JOIN link_row lr ON true;
END;
$$;

REVOKE ALL ON FUNCTION get_personal_lesson_google_sync_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_personal_lesson_google_sync_status(uuid) TO authenticated;

REVOKE ALL ON FUNCTION get_group_occurrence_google_sync_status(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_group_occurrence_google_sync_status(uuid, date) TO authenticated;

COMMIT;
