-- Google Calendar: event title/location format refresh + manual full resync

BEGIN;

DROP FUNCTION IF EXISTS execute_member_personal_lessons_reconcile(uuid, uuid);
DROP FUNCTION IF EXISTS execute_member_group_occurrences_reconcile(uuid, uuid);

ALTER TABLE calendar_sync_outbox
  DROP CONSTRAINT IF EXISTS calendar_sync_outbox_operation_check;

ALTER TABLE calendar_sync_outbox
  ADD CONSTRAINT calendar_sync_outbox_operation_check
  CHECK (operation IN (
    'upsert',
    'delete',
    'reconcile_member',
    'refresh_member',
    'incremental_sync'
  ));

CREATE OR REPLACE FUNCTION enqueue_calendar_sync(
  p_organization_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_occurrence_date date,
  p_operation text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dedupe_key text;
BEGIN
  IF p_operation = 'reconcile_member' THEN
    v_dedupe_key := 'reconcile_member:' || p_source_id::text;
  ELSIF p_operation = 'refresh_member' THEN
    v_dedupe_key := 'refresh_member:' || p_source_id::text;
  ELSIF p_operation = 'incremental_sync' THEN
    IF p_source_type = 'member_binding' THEN
      v_dedupe_key := 'incremental_sync:member:' || p_source_id::text;
    ELSIF p_source_type = 'organization_binding' THEN
      v_dedupe_key := 'incremental_sync:org:' || p_source_id::text;
    ELSE
      RAISE EXCEPTION 'invalid_incremental_sync_source_type';
    END IF;
  ELSE
    IF p_occurrence_date IS NULL THEN
      RAISE EXCEPTION 'calendar_sync_occurrence_date_required';
    END IF;
    v_dedupe_key := build_calendar_sync_dedupe_key(
      p_source_type,
      p_source_id,
      p_occurrence_date
    );
  END IF;

  INSERT INTO calendar_sync_outbox (
    organization_id,
    source_type,
    source_id,
    occurrence_date,
    dedupe_key,
    operation,
    status,
    available_at
  ) VALUES (
    p_organization_id,
    p_source_type,
    p_source_id,
    p_occurrence_date,
    v_dedupe_key,
    p_operation,
    'pending',
    now()
  )
  ON CONFLICT (organization_id, dedupe_key)
    WHERE status IN ('pending', 'retry')
  DO UPDATE SET
    source_type = EXCLUDED.source_type,
    source_id = EXCLUDED.source_id,
    occurrence_date = EXCLUDED.occurrence_date,
    operation = EXCLUDED.operation,
    status = 'pending',
    attempt_count = 0,
    available_at = now(),
    locked_at = NULL,
    locked_by = NULL,
    last_error_code = NULL,
    last_error_message = NULL,
    processed_at = NULL;
END;
$$;

CREATE OR REPLACE FUNCTION execute_member_personal_lessons_reconcile(
  p_organization_id uuid,
  p_member_id uuid,
  p_force_refresh boolean DEFAULT false
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
      AND (
        p_force_refresh
        OR NOT EXISTS (
          SELECT 1
          FROM google_calendar_event_links l
          WHERE l.member_binding_id = v_binding_id
            AND l.source_type = 'personal_lesson'
            AND l.source_id = pl.id
            AND l.occurrence_date = pl.date
            AND l.sync_status IN ('synced', 'pending')
        )
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
    'deletes_enqueued', v_deletes,
    'force_refresh', p_force_refresh
  );
END;
$$;

REVOKE ALL ON FUNCTION execute_member_personal_lessons_reconcile(uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION execute_member_personal_lessons_reconcile(uuid, uuid, boolean) TO service_role;

CREATE OR REPLACE FUNCTION execute_member_group_occurrences_reconcile(
  p_organization_id uuid,
  p_member_id uuid,
  p_force_refresh boolean DEFAULT false
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

      IF p_force_refresh
         OR NOT EXISTS (
           SELECT 1
           FROM google_calendar_event_links l
           WHERE l.member_binding_id = v_binding_id
             AND l.source_type = 'group_occurrence'
             AND l.source_id = r_slot.id
             AND l.occurrence_date = v_date
             AND l.sync_status IN ('synced', 'pending')
         )
      THEN
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
    'deletes_enqueued', v_deletes,
    'force_refresh', p_force_refresh
  );
END;
$$;

REVOKE ALL ON FUNCTION execute_member_group_occurrences_reconcile(uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION execute_member_group_occurrences_reconcile(uuid, uuid, boolean) TO service_role;

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
    'refresh_member'
  );

  RETURN jsonb_build_object('ok', true, 'refresh', true);
END;
$$;

COMMIT;
