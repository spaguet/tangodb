-- Google Calendar: cron reconciliation, dead-letter retry, metrics (GCAL Prompt 7)

BEGIN;

-- =============================================================================
-- 1. Reconcile personal lessons for one member (worker + reconcile_member job)
-- =============================================================================

CREATE OR REPLACE FUNCTION execute_member_personal_lessons_reconcile(
  p_organization_id uuid,
  p_member_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_binding_id uuid;
  v_upserts int := 0;
  v_deletes int := 0;
  r RECORD;
BEGIN
  SELECT b.id
  INTO v_binding_id
  FROM member_google_calendar_bindings b
  JOIN organization_members om
    ON om.organization_id = b.organization_id
   AND om.id = b.organization_member_id
  WHERE b.organization_id = p_organization_id
    AND b.organization_member_id = p_member_id
    AND b.enabled = true
    AND b.sync_personal = true
    AND om.is_active = true
  LIMIT 1;

  IF v_binding_id IS NULL THEN
    RETURN jsonb_build_object(
      'skipped', true,
      'reason', 'no_active_binding',
      'upserts_enqueued', 0,
      'deletes_enqueued', 0
    );
  END IF;

  FOR r IN
    SELECT pl.id, pl.date
    FROM personal_lessons pl
    WHERE pl.organization_id = p_organization_id
      AND pl.teacher_member_id = p_member_id
      AND pl.date >= CURRENT_DATE
      AND pl.cancelled_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM google_calendar_event_links l
        WHERE l.member_binding_id = v_binding_id
          AND l.source_type = 'personal_lesson'
          AND l.source_id = pl.id
          AND l.occurrence_date = pl.date
          AND l.sync_status IN ('synced', 'pending')
      )
  LOOP
    PERFORM enqueue_calendar_sync(
      p_organization_id,
      'personal_lesson',
      r.id,
      r.date,
      'upsert'
    );
    v_upserts := v_upserts + 1;
  END LOOP;

  FOR r IN
    SELECT l.source_id, l.occurrence_date
    FROM google_calendar_event_links l
    LEFT JOIN personal_lessons pl
      ON pl.organization_id = l.organization_id
     AND pl.id = l.source_id
    WHERE l.organization_id = p_organization_id
      AND l.member_binding_id = v_binding_id
      AND l.source_type = 'personal_lesson'
      AND l.sync_status <> 'detached'
      AND (
        pl.id IS NULL
        OR pl.cancelled_at IS NOT NULL
        OR pl.date IS DISTINCT FROM l.occurrence_date
        OR pl.teacher_member_id IS DISTINCT FROM p_member_id
      )
  LOOP
    PERFORM enqueue_calendar_sync(
      p_organization_id,
      'personal_lesson',
      r.source_id,
      r.occurrence_date,
      'delete'
    );
    v_deletes := v_deletes + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'skipped', false,
    'binding_id', v_binding_id,
    'upserts_enqueued', v_upserts,
    'deletes_enqueued', v_deletes
  );
END;
$$;

REVOKE ALL ON FUNCTION execute_member_personal_lessons_reconcile(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION execute_member_personal_lessons_reconcile(uuid, uuid) TO service_role;

-- =============================================================================
-- 2. Manual reconcile request (settings UI — «Синхронизировать будущие уроки»)
-- =============================================================================

CREATE OR REPLACE FUNCTION request_member_calendar_reconcile(
  p_organization_member_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid;
  v_member_user_id uuid;
BEGIN
  v_org_id := auth_organization_id();
  IF v_org_id IS NULL OR NOT business_row_readable() THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT om.user_id
  INTO v_member_user_id
  FROM organization_members om
  WHERE om.id = p_organization_member_id
    AND om.organization_id = v_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'member_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_member_user_id IS DISTINCT FROM auth.uid()
     AND current_member_role() NOT IN ('owner', 'director') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  PERFORM enqueue_calendar_sync(
    v_org_id,
    'personal_lesson',
    p_organization_member_id,
    NULL,
    'reconcile_member'
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION request_member_calendar_reconcile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_member_calendar_reconcile(uuid) TO authenticated;

-- =============================================================================
-- 3. Hourly reconciliation — enqueue reconcile_member per active binding
-- =============================================================================

CREATE OR REPLACE FUNCTION run_personal_lessons_calendar_reconciliation()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT b.organization_id, b.organization_member_id
    FROM member_google_calendar_bindings b
    JOIN organization_members om
      ON om.organization_id = b.organization_id
     AND om.id = b.organization_member_id
    WHERE b.enabled = true
      AND b.sync_personal = true
      AND om.is_active = true
  LOOP
    PERFORM enqueue_calendar_sync(
      r.organization_id,
      'personal_lesson',
      r.organization_member_id,
      NULL,
      'reconcile_member'
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('reconcile_jobs_enqueued', v_count);
END;
$$;

REVOKE ALL ON FUNCTION run_personal_lessons_calendar_reconciliation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION run_personal_lessons_calendar_reconciliation() TO service_role;

-- =============================================================================
-- 4. Dead-letter retry (backend for Prompt 8 UI)
-- =============================================================================

CREATE OR REPLACE FUNCTION retry_calendar_sync_dead_job(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid;
  v_updated int;
BEGIN
  v_org_id := auth_organization_id();
  IF v_org_id IS NULL OR NOT business_row_readable() THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  IF current_member_role() NOT IN ('owner', 'director') THEN
    -- Members may retry dead jobs only for their own personal_lesson rows
    UPDATE calendar_sync_outbox o
    SET
      status = 'pending',
      attempt_count = 0,
      available_at = now(),
      locked_at = NULL,
      locked_by = NULL,
      last_error_code = NULL,
      last_error_message = NULL,
      processed_at = NULL
    WHERE o.id = p_job_id
      AND o.organization_id = v_org_id
      AND o.status = 'dead'
      AND o.source_type = 'personal_lesson'
      AND EXISTS (
        SELECT 1
        FROM personal_lessons pl
        WHERE pl.id = o.source_id
          AND pl.organization_id = v_org_id
          AND pl.teacher_member_id = auth_member_id()
      );

    GET DIAGNOSTICS v_updated = ROW_COUNT;
  ELSE
    UPDATE calendar_sync_outbox o
    SET
      status = 'pending',
      attempt_count = 0,
      available_at = now(),
      locked_at = NULL,
      locked_by = NULL,
      last_error_code = NULL,
      last_error_message = NULL,
      processed_at = NULL
    WHERE o.id = p_job_id
      AND o.organization_id = v_org_id
      AND o.status = 'dead';

    GET DIAGNOSTICS v_updated = ROW_COUNT;
  END IF;

  IF v_updated = 0 THEN
    RAISE EXCEPTION 'job_not_found_or_not_dead' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object('ok', true, 'job_id', p_job_id);
END;
$$;

REVOKE ALL ON FUNCTION retry_calendar_sync_dead_job(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retry_calendar_sync_dead_job(uuid) TO authenticated;

-- =============================================================================
-- 5. Org-level sync queue metrics (Prompt 8 team dashboard)
-- =============================================================================

CREATE OR REPLACE FUNCTION get_organization_calendar_sync_metrics()
RETURNS TABLE (
  pending_count bigint,
  retry_count bigint,
  processing_count bigint,
  dead_count bigint,
  oldest_pending_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    COUNT(*) FILTER (WHERE o.status = 'pending') AS pending_count,
    COUNT(*) FILTER (WHERE o.status = 'retry') AS retry_count,
    COUNT(*) FILTER (WHERE o.status = 'processing') AS processing_count,
    COUNT(*) FILTER (WHERE o.status = 'dead') AS dead_count,
    MIN(o.created_at) FILTER (WHERE o.status IN ('pending', 'retry')) AS oldest_pending_at
  FROM calendar_sync_outbox o
  WHERE o.organization_id = auth_organization_id()
    AND business_row_readable()
    AND current_member_role() IN ('owner', 'director');
$$;

REVOKE ALL ON FUNCTION get_organization_calendar_sync_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_organization_calendar_sync_metrics() TO authenticated;

-- Per-member metrics for team integrations view (Prompt 8)
CREATE OR REPLACE FUNCTION get_team_calendar_sync_metrics()
RETURNS TABLE (
  organization_member_id uuid,
  member_name text,
  has_active_binding boolean,
  binding_last_success_at timestamptz,
  binding_last_error_code text,
  pending_jobs_count bigint,
  dead_jobs_count bigint,
  failed_links_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    om.id AS organization_member_id,
    COALESCE(NULLIF(trim(om.display_name), ''), om.role::text) AS member_name,
    (b.id IS NOT NULL) AS has_active_binding,
    b.last_success_at AS binding_last_success_at,
    b.last_error_code AS binding_last_error_code,
    (
      SELECT COUNT(*)
      FROM calendar_sync_outbox o
      WHERE o.organization_id = om.organization_id
        AND o.status IN ('pending', 'retry', 'processing')
        AND o.source_type = 'personal_lesson'
        AND (
          (o.operation = 'reconcile_member' AND o.source_id = om.id)
          OR EXISTS (
            SELECT 1
            FROM personal_lessons pl
            WHERE pl.id = o.source_id
              AND pl.organization_id = om.organization_id
              AND pl.teacher_member_id = om.id
          )
        )
    ) AS pending_jobs_count,
    (
      SELECT COUNT(*)
      FROM calendar_sync_outbox o
      WHERE o.organization_id = om.organization_id
        AND o.status = 'dead'
        AND o.source_type = 'personal_lesson'
        AND (
          (o.operation = 'reconcile_member' AND o.source_id = om.id)
          OR EXISTS (
            SELECT 1
            FROM personal_lessons pl
            WHERE pl.id = o.source_id
              AND pl.organization_id = om.organization_id
              AND pl.teacher_member_id = om.id
          )
        )
    ) AS dead_jobs_count,
    (
      SELECT COUNT(*)
      FROM google_calendar_event_links l
      JOIN member_google_calendar_bindings mb ON mb.id = l.member_binding_id
      WHERE mb.organization_member_id = om.id
        AND mb.organization_id = om.organization_id
        AND mb.enabled = true
        AND l.sync_status = 'failed'
    ) AS failed_links_count
  FROM organization_members om
  LEFT JOIN member_google_calendar_bindings b
    ON b.organization_id = om.organization_id
   AND b.organization_member_id = om.id
   AND b.enabled = true
  WHERE om.organization_id = auth_organization_id()
    AND business_row_readable()
    AND current_member_role() IN ('owner', 'director')
    AND om.is_active = true
  ORDER BY member_name;
$$;

REVOKE ALL ON FUNCTION get_team_calendar_sync_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_team_calendar_sync_metrics() TO authenticated;

COMMIT;
