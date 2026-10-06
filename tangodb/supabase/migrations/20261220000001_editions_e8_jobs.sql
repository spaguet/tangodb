-- E8 / 2.12.11: cron reconcile + horizon skip non-Pro when editions_lifecycle on (F96/F91).

BEGIN;

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
  IF editions_lifecycle_enabled() AND NOT edition_allows(p_organization_id, 'google_calendar') THEN
    RETURN jsonb_build_object(
      'skipped', true,
      'reason', 'edition_paused',
      'upserts_enqueued', 0,
      'deletes_enqueued', 0
    );
  END IF;

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
  IF editions_lifecycle_enabled() AND NOT edition_allows(p_organization_id, 'google_calendar') THEN
    RETURN jsonb_build_object(
      'skipped', true,
      'reason', 'edition_paused',
      'upserts_enqueued', 0,
      'deletes_enqueued', 0
    );
  END IF;

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
    IF editions_lifecycle_enabled()
       AND NOT edition_allows(r.organization_id, 'google_calendar') THEN
      CONTINUE;
    END IF;

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

CREATE OR REPLACE FUNCTION run_group_occurrence_horizon_extension()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target date := CURRENT_DATE + 90;
  v_count int := 0;
  r schedule_slots%ROWTYPE;
BEGIN
  FOR r IN
    SELECT ss.*
    FROM schedule_slots ss
    WHERE ss.valid_from <= v_target
      AND (ss.valid_to IS NULL OR ss.valid_to >= v_target)
      AND (ss.valid_to IS NULL OR ss.valid_to > ss.valid_from)
  LOOP
    IF editions_lifecycle_enabled()
       AND NOT edition_allows(r.organization_id, 'google_calendar') THEN
      CONTINUE;
    END IF;

    IF NOT _is_group_slot_occurrence_date(r, v_target) THEN
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM schedule_occurrence_cancellations c
      WHERE c.organization_id = r.organization_id
        AND c.slot_id = r.id
        AND c.occurrence_date = v_target
    ) THEN
      CONTINUE;
    END IF;

    PERFORM enqueue_calendar_sync(
      r.organization_id,
      'group_occurrence',
      r.id,
      v_target,
      'upsert'
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'target_date', v_target,
    'upserts_enqueued', v_count
  );
END;
$$;

COMMIT;
