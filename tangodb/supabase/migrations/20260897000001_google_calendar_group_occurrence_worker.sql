-- Google Calendar: group occurrence worker reconcile (GCAL Prompt 10)

BEGIN;

-- =============================================================================
-- 1. Reconcile group occurrences for one member (horizon 7/90)
-- =============================================================================

CREATE OR REPLACE FUNCTION execute_member_group_occurrences_reconcile(
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
  v_start date;
  v_end date;
  v_upserts int := 0;
  v_deletes int := 0;
  r_slot schedule_slots%ROWTYPE;
  v_date date;
  v_dates date[];
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
    AND b.sync_group = true
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

  SELECT h.horizon_start, h.horizon_end
  INTO v_start, v_end
  FROM gcal_group_occurrence_horizon_bounds() AS h;

  FOR r_slot IN
    SELECT ss.*
    FROM schedule_slots ss
    WHERE ss.organization_id = p_organization_id
      AND ss.teacher_member_id = p_member_id
      AND ss.valid_from <= v_end
      AND (ss.valid_to IS NULL OR ss.valid_to >= v_start)
      AND (ss.valid_to IS NULL OR ss.valid_to > ss.valid_from)
  LOOP
    v_dates := _group_slot_occurrences_in_range(r_slot, v_start, v_end);

    FOREACH v_date IN ARRAY v_dates
    LOOP
      IF EXISTS (
        SELECT 1
        FROM schedule_occurrence_cancellations c
        WHERE c.organization_id = p_organization_id
          AND c.slot_id = r_slot.id
          AND c.occurrence_date = v_date
      ) THEN
        CONTINUE;
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM google_calendar_event_links l
        WHERE l.member_binding_id = v_binding_id
          AND l.source_type = 'group_occurrence'
          AND l.source_id = r_slot.id
          AND l.occurrence_date = v_date
          AND l.sync_status IN ('synced', 'pending')
      ) THEN
        PERFORM enqueue_calendar_sync(
          p_organization_id,
          'group_occurrence',
          r_slot.id,
          v_date,
          'upsert'
        );
        v_upserts := v_upserts + 1;
      END IF;
    END LOOP;
  END LOOP;

  FOR r_slot IN
    SELECT l.source_id, l.occurrence_date
    FROM google_calendar_event_links l
    LEFT JOIN schedule_slots ss
      ON ss.organization_id = l.organization_id
     AND ss.id = l.source_id
    WHERE l.organization_id = p_organization_id
      AND l.member_binding_id = v_binding_id
      AND l.source_type = 'group_occurrence'
      AND l.sync_status <> 'detached'
      AND (
        ss.id IS NULL
        OR ss.teacher_member_id IS DISTINCT FROM p_member_id
        OR NOT _is_group_slot_occurrence_date(ss, l.occurrence_date)
        OR EXISTS (
          SELECT 1
          FROM schedule_occurrence_cancellations c
          WHERE c.organization_id = l.organization_id
            AND c.slot_id = l.source_id
            AND c.occurrence_date = l.occurrence_date
        )
      )
  LOOP
    PERFORM enqueue_calendar_sync(
      p_organization_id,
      'group_occurrence',
      r_slot.source_id,
      r_slot.occurrence_date,
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

REVOKE ALL ON FUNCTION execute_member_group_occurrences_reconcile(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION execute_member_group_occurrences_reconcile(uuid, uuid) TO service_role;

-- =============================================================================
-- 2. Hourly reconciliation — include bindings with sync_group
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
      AND (b.sync_personal = true OR b.sync_group = true)
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

-- =============================================================================
-- 3. Dead-letter retry — allow group_occurrence for teacher's slots
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
      AND (
        (o.source_type = 'personal_lesson' AND EXISTS (
          SELECT 1
          FROM personal_lessons pl
          WHERE pl.id = o.source_id
            AND pl.organization_id = v_org_id
            AND pl.teacher_member_id = auth_member_id()
        ))
        OR (o.source_type = 'group_occurrence' AND EXISTS (
          SELECT 1
          FROM schedule_slots ss
          WHERE ss.id = o.source_id
            AND ss.organization_id = v_org_id
            AND ss.teacher_member_id = auth_member_id()
        ))
        OR (o.operation = 'reconcile_member' AND o.source_id = auth_member_id())
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

-- =============================================================================
-- 4. Backfill sync_group for existing active bindings (sync_personal was on)
-- =============================================================================

UPDATE member_google_calendar_bindings
SET sync_group = true,
    updated_at = now()
WHERE enabled = true
  AND sync_personal = true
  AND sync_group = false;

COMMIT;
