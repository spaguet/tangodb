-- Prompt 8: lesson sync status RPC (teacher pending visibility) + outbox SELECT for teachers

BEGIN;

-- Teachers may see outbox jobs for their own personal lessons (pending indicator in lesson UI).
CREATE POLICY calendar_sync_outbox_select_teacher_personal
  ON calendar_sync_outbox FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND current_member_role() = 'teacher'
    AND source_type = 'personal_lesson'
    AND (
      EXISTS (
        SELECT 1
        FROM personal_lessons pl
        WHERE pl.id = source_id
          AND pl.organization_id = calendar_sync_outbox.organization_id
          AND pl.teacher_member_id = auth_member_id()
      )
      OR (
        operation = 'reconcile_member'
        AND source_id = auth_member_id()
      )
    )
  );

DROP FUNCTION IF EXISTS get_personal_lesson_google_sync_status(uuid);

CREATE OR REPLACE FUNCTION get_personal_lesson_google_sync_status(p_lesson_id uuid)
RETURNS TABLE (
  sync_status text,
  last_synced_at timestamptz,
  last_error text,
  has_pending_job boolean,
  teacher_has_binding boolean
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
      l.last_error
    FROM google_calendar_event_links l
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
    SELECT EXISTS (
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
    ) AS teacher_has_binding
  )
  SELECT
    lr.sync_status,
    lr.last_synced_at,
    lr.last_error,
    COALESCE(pj.has_pending_job, false),
    COALESCE(tb.teacher_has_binding, false)
  FROM teacher_binding tb
  CROSS JOIN pending_job pj
  LEFT JOIN link_row lr ON true;
END;
$$;

REVOKE ALL ON FUNCTION get_personal_lesson_google_sync_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_personal_lesson_google_sync_status(uuid) TO authenticated;

COMMIT;
