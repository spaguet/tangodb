-- Cancel/split group slots without DELETE: single_visits and lesson closures
-- reference schedule_slots with ON DELETE RESTRICT.

BEGIN;

CREATE OR REPLACE FUNCTION _retire_schedule_slot_locked(p_slot_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_from date;
BEGIN
  SELECT COALESCE(valid_from, DATE '2000-01-01')
  INTO v_from
  FROM schedule_slots
  WHERE id = p_slot_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE schedule_slots
  SET valid_to = v_from - 1
  WHERE id = p_slot_id;
END;
$$;

CREATE OR REPLACE FUNCTION _cancel_group_lesson_occurrence_locked(
  p_slot schedule_slots,
  p_cancel_date date
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_valid_from date := COALESCE(p_slot.valid_from, DATE '2000-01-01');
  v_valid_to date := p_slot.valid_to;
  v_close_to date;
  v_resume_from date;
  v_new_from date;
  v_new_to date;
BEGIN
  IF p_cancel_date < v_valid_from THEN
    RAISE EXCEPTION 'schedule.error.cancelDateInvalid' USING ERRCODE = 'P0001';
  END IF;

  IF v_valid_to IS NOT NULL AND p_cancel_date > v_valid_to THEN
    RAISE EXCEPTION 'schedule.error.cancelDateInvalid' USING ERRCODE = 'P0001';
  END IF;

  IF v_valid_to IS NOT NULL AND v_valid_from = v_valid_to THEN
    PERFORM _retire_schedule_slot_locked(p_slot.id);
    RETURN;
  END IF;

  IF p_cancel_date = v_valid_from THEN
    v_new_from := p_cancel_date + 7;
    IF v_valid_to IS NOT NULL AND v_new_from > v_valid_to THEN
      PERFORM _retire_schedule_slot_locked(p_slot.id);
      RETURN;
    END IF;

    UPDATE schedule_slots
    SET valid_from = v_new_from
    WHERE id = p_slot.id;
    RETURN;
  END IF;

  IF v_valid_to IS NOT NULL AND p_cancel_date = v_valid_to THEN
    v_new_to := p_cancel_date - 7;
    IF v_new_to < v_valid_from THEN
      PERFORM _retire_schedule_slot_locked(p_slot.id);
      RETURN;
    END IF;

    UPDATE schedule_slots
    SET valid_to = v_new_to
    WHERE id = p_slot.id;
    RETURN;
  END IF;

  v_close_to := p_cancel_date - 7;
  IF v_close_to >= v_valid_from THEN
    UPDATE schedule_slots
    SET valid_to = v_close_to
    WHERE id = p_slot.id;
  ELSE
    PERFORM _retire_schedule_slot_locked(p_slot.id);
  END IF;

  v_resume_from := p_cancel_date + 7;
  IF v_valid_to IS NULL OR v_resume_from <= v_valid_to THEN
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
      valid_to
    )
    VALUES (
      p_slot.organization_id,
      p_slot.day_of_week,
      p_slot.time,
      p_slot.time_end,
      p_slot.discipline_id,
      p_slot.group_name,
      p_slot.location_id,
      p_slot.teacher_member_id,
      p_slot.class_id,
      v_resume_from,
      v_valid_to
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION _apply_group_slot_cancellations_locked(
  p_slot_id uuid,
  p_sorted_dates date[]
)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_slot schedule_slots%ROWTYPE;
  v_cancel date;
  v_valid_from date;
  v_valid_to date;
  v_current_start date;
  v_close_to date;
  v_segment_count integer := 0;
  v_first_segment boolean := true;
  v_seg_from date;
  v_seg_to date;
BEGIN
  SELECT *
  INTO v_slot
  FROM schedule_slots ss
  WHERE ss.id = p_slot_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'schedule.error.slotNotFound' USING ERRCODE = 'P0001';
  END IF;

  v_valid_from := COALESCE(v_slot.valid_from, DATE '2000-01-01');
  v_valid_to := v_slot.valid_to;

  CREATE TEMP TABLE IF NOT EXISTS _cancel_segments (
    valid_from date NOT NULL,
    valid_to date
  ) ON COMMIT DROP;

  TRUNCATE _cancel_segments;

  v_current_start := v_valid_from;

  FOREACH v_cancel IN ARRAY p_sorted_dates LOOP
    v_close_to := v_cancel - 7;
    IF v_close_to >= v_current_start THEN
      INSERT INTO _cancel_segments (valid_from, valid_to)
      VALUES (v_current_start, v_close_to);
    END IF;
    v_current_start := v_cancel + 7;
  END LOOP;

  IF v_valid_to IS NULL OR v_current_start <= v_valid_to THEN
    INSERT INTO _cancel_segments (valid_from, valid_to)
    VALUES (v_current_start, v_valid_to);
  END IF;

  SELECT count(*) INTO v_segment_count FROM _cancel_segments;

  IF v_segment_count = 0 THEN
    PERFORM _retire_schedule_slot_locked(p_slot_id);
  ELSIF v_segment_count = 1 THEN
    SELECT valid_from, valid_to
    INTO v_seg_from, v_seg_to
    FROM _cancel_segments
    LIMIT 1;

    UPDATE schedule_slots
    SET valid_from = v_seg_from,
        valid_to = v_seg_to
    WHERE id = p_slot_id;
  ELSE
    v_first_segment := true;
    FOR v_seg_from, v_seg_to IN
      SELECT valid_from, valid_to FROM _cancel_segments ORDER BY valid_from
    LOOP
      IF v_first_segment THEN
        UPDATE schedule_slots
        SET valid_from = v_seg_from,
            valid_to = v_seg_to
        WHERE id = p_slot_id;
        v_first_segment := false;
      ELSE
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
          valid_to
        )
        VALUES (
          v_slot.organization_id,
          v_slot.day_of_week,
          v_slot.time,
          v_slot.time_end,
          v_slot.discipline_id,
          v_slot.group_name,
          v_slot.location_id,
          v_slot.teacher_member_id,
          v_slot.class_id,
          v_seg_from,
          v_seg_to
        );
      END IF;
    END LOOP;
  END IF;

  RETURN array_length(p_sorted_dates, 1);
END;
$$;

CREATE OR REPLACE FUNCTION prevent_personal_lesson_overlap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM personal_lessons p
    WHERE p.organization_id = NEW.organization_id
      AND p.date = NEW.date
      AND p.location_id IS NOT DISTINCT FROM NEW.location_id
      AND p.id IS DISTINCT FROM NEW.id
      AND p.cancelled_at IS NULL
      AND schedule_time_ranges_overlap(
        p.time_start, p.time_end, NEW.time_start, NEW.time_end
      )
  ) THEN
    RAISE EXCEPTION 'personal_lesson_overlap'
      USING ERRCODE = 'P0001',
            DETAIL = 'Overlapping personal lesson in the same location and date';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM schedule_slots s
    WHERE s.organization_id = NEW.organization_id
      AND s.day_of_week = EXTRACT(ISODOW FROM NEW.date)::INT
      AND s.location_id IS NOT DISTINCT FROM NEW.location_id
      AND s.valid_from <= NEW.date
      AND (s.valid_to IS NULL OR s.valid_to >= NEW.date)
      AND schedule_time_ranges_overlap(
        s.time, s.time_end, NEW.time_start, NEW.time_end
      )
      AND NOT EXISTS (
        SELECT 1
        FROM schedule_occurrence_cancellations c
        WHERE c.organization_id = NEW.organization_id
          AND c.slot_id = s.id
          AND c.occurrence_date = NEW.date
      )
  ) THEN
    RAISE EXCEPTION 'personal_group_overlap'
      USING ERRCODE = 'P0001',
            DETAIL = 'Personal lesson overlaps with group schedule slot';
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
