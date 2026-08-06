-- Google Calendar: group occurrence materialization + enqueue (GCAL Prompt 9)

BEGIN;

-- =============================================================================
-- 1. Horizon bounds (7 days back / 90 days forward — decision GCAL-0)
-- =============================================================================

CREATE OR REPLACE FUNCTION gcal_group_occurrence_horizon_bounds()
RETURNS TABLE (horizon_start date, horizon_end date)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT (CURRENT_DATE - 7)::date, (CURRENT_DATE + 90)::date;
$$;

-- =============================================================================
-- 2. Enqueue helpers for group_occurrence
-- =============================================================================

CREATE OR REPLACE FUNCTION enqueue_group_slot_occurrences_in_horizon(
  p_slot schedule_slots,
  p_operation text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start date;
  v_end date;
  v_date date;
BEGIN
  SELECT h.horizon_start, h.horizon_end
  INTO v_start, v_end
  FROM gcal_group_occurrence_horizon_bounds() AS h;

  IF p_slot.valid_to IS NOT NULL AND p_slot.valid_to <= p_slot.valid_from THEN
    RETURN;
  END IF;

  FOREACH v_date IN ARRAY _group_slot_occurrences_in_range(p_slot, v_start, v_end)
  LOOP
    PERFORM enqueue_calendar_sync(
      p_slot.organization_id,
      'group_occurrence',
      p_slot.id,
      v_date,
      p_operation
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION enqueue_group_slot_occurrences_in_horizon(schedule_slots, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION enqueue_group_slot_occurrences_in_horizon(schedule_slots, text) TO service_role;

-- =============================================================================
-- 3. schedule_slots triggers (INSERT / UPDATE / DELETE)
-- =============================================================================

CREATE OR REPLACE FUNCTION schedule_slots_calendar_sync_enqueue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start date;
  v_end date;
  v_old_dates date[];
  v_new_dates date[];
  v_date date;
BEGIN
  SELECT h.horizon_start, h.horizon_end
  INTO v_start, v_end
  FROM gcal_group_occurrence_horizon_bounds() AS h;

  IF TG_OP = 'INSERT' THEN
    PERFORM enqueue_group_slot_occurrences_in_horizon(NEW, 'upsert');
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM enqueue_group_slot_occurrences_in_horizon(OLD, 'delete');
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_old_dates := _group_slot_occurrences_in_range(OLD, v_start, v_end);
    v_new_dates := _group_slot_occurrences_in_range(NEW, v_start, v_end);

    FOREACH v_date IN ARRAY v_old_dates
    LOOP
      IF NOT (v_date = ANY (v_new_dates)) THEN
        PERFORM enqueue_calendar_sync(
          OLD.organization_id,
          'group_occurrence',
          OLD.id,
          v_date,
          'delete'
        );
      END IF;
    END LOOP;

    FOREACH v_date IN ARRAY v_new_dates
    LOOP
      PERFORM enqueue_calendar_sync(
        NEW.organization_id,
        'group_occurrence',
        NEW.id,
        v_date,
        'upsert'
      );
    END LOOP;

    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$;

CREATE TRIGGER schedule_slots_calendar_sync_after_insert_trg
  AFTER INSERT ON schedule_slots
  FOR EACH ROW
  EXECUTE FUNCTION schedule_slots_calendar_sync_enqueue();

CREATE TRIGGER schedule_slots_calendar_sync_after_update_trg
  AFTER UPDATE ON schedule_slots
  FOR EACH ROW
  EXECUTE FUNCTION schedule_slots_calendar_sync_enqueue();

CREATE TRIGGER schedule_slots_calendar_sync_before_delete_trg
  BEFORE DELETE ON schedule_slots
  FOR EACH ROW
  EXECUTE FUNCTION schedule_slots_calendar_sync_enqueue();

-- =============================================================================
-- 4. schedule_occurrence_cancellations → delete enqueue
-- =============================================================================

CREATE OR REPLACE FUNCTION schedule_occurrence_cancellations_calendar_sync_enqueue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.slot_id IS NOT NULL THEN
    PERFORM enqueue_calendar_sync(
      NEW.organization_id,
      'group_occurrence',
      NEW.slot_id,
      NEW.occurrence_date,
      'delete'
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER schedule_cancellations_gcal_sync_trg
  AFTER INSERT ON schedule_occurrence_cancellations
  FOR EACH ROW
  EXECUTE FUNCTION schedule_occurrence_cancellations_calendar_sync_enqueue();

-- =============================================================================
-- 5. Daily horizon extension (enqueue upsert for day at horizon end)
-- =============================================================================

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

REVOKE ALL ON FUNCTION run_group_occurrence_horizon_extension() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION run_group_occurrence_horizon_extension() TO service_role;

-- =============================================================================
-- 6. move_group_lesson_occurrence — explicit delete old + upsert new
-- =============================================================================

CREATE OR REPLACE FUNCTION move_group_lesson_occurrence(
  p_slot_id uuid,
  p_source_date text,
  p_target_date text,
  p_target_time_start text,
  p_target_time_end text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_slot schedule_slots%ROWTYPE;
  v_source_date date;
  v_target_date date;
  v_time_start text;
  v_time_end text;
  v_target_dow integer;
  v_new_slot_id uuid;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.orgReadOnly');
  END IF;

  IF NOT member_can_write_schedule_slot(p_slot_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.moveForbidden');
  END IF;

  IF p_source_date !~ '^\d{4}-\d{2}-\d{2}$'
     OR p_target_date !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.moveInvalidTarget');
  END IF;

  v_source_date := p_source_date::date;
  v_target_date := p_target_date::date;

  BEGIN
    v_time_start := normalize_hhmm(p_target_time_start);
    v_time_end := normalize_hhmm(p_target_time_end);
  EXCEPTION
    WHEN OTHERS THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.error.moveInvalidTarget');
  END;

  IF split_part(v_time_start, ':', 1)::int * 60 + split_part(v_time_start, ':', 2)::int
     >= split_part(v_time_end, ':', 1)::int * 60 + split_part(v_time_end, ':', 2)::int THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.moveInvalidTarget');
  END IF;

  SELECT *
  INTO v_slot
  FROM schedule_slots ss
  WHERE ss.id = p_slot_id
    AND ss.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.slotNotFound');
  END IF;

  IF v_slot.valid_to IS NOT NULL AND v_slot.valid_to <= v_slot.valid_from THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.moveNotRecurring');
  END IF;

  IF v_source_date < COALESCE(v_slot.valid_from, DATE '2000-01-01')
     OR (v_slot.valid_to IS NOT NULL AND v_source_date > v_slot.valid_to) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.cancelDateInvalid');
  END IF;

  IF EXTRACT(ISODOW FROM v_source_date)::integer <> v_slot.day_of_week THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.cancelDateInvalid');
  END IF;

  v_target_dow := EXTRACT(ISODOW FROM v_target_date)::integer;

  IF v_source_date = v_target_date
     AND v_slot.time = v_time_start
     AND v_slot.time_end = v_time_end THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.moveSameSlot');
  END IF;

  IF schedule_location_has_conflict(
    v_org_id,
    v_target_date,
    v_time_start,
    v_time_end,
    v_slot.location_id,
    NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.groupOverlap');
  END IF;

  PERFORM _cancel_group_lesson_occurrence_locked(v_slot, v_source_date);

  INSERT INTO schedule_slots (
    organization_id,
    day_of_week,
    time,
    time_end,
    discipline_id,
    group_name,
    location_id,
    teacher_member_id,
    class_id,
    valid_from,
    valid_to,
    moved_from_slot_id,
    moved_from_date,
    moved_from_time
  )
  VALUES (
    v_org_id,
    v_target_dow,
    v_time_start,
    v_time_end,
    v_slot.discipline_id,
    v_slot.group_name,
    v_slot.location_id,
    v_slot.teacher_member_id,
    v_slot.class_id,
    v_target_date,
    v_target_date,
    p_slot_id,
    v_source_date,
    v_slot.time
  )
  RETURNING id INTO v_new_slot_id;

  PERFORM enqueue_calendar_sync(
    v_org_id,
    'group_occurrence',
    p_slot_id,
    v_source_date,
    'delete'
  );
  PERFORM enqueue_calendar_sync(
    v_org_id,
    'group_occurrence',
    v_new_slot_id,
    v_target_date,
    'upsert'
  );

  RETURN jsonb_build_object(
    'success', true,
    'new_slot_id', v_new_slot_id
  );
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
  WHEN OTHERS THEN
    IF SQLERRM LIKE '%schedule_slot_overlap%' OR SQLERRM LIKE '%personal_group_overlap%' THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.error.groupOverlap');
    END IF;
    IF SQLERRM LIKE '%personal_lesson_overlap%' THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.error.groupOverlap');
    END IF;
    RAISE;
END;
$$;

COMMIT;
