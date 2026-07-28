-- Atomic move of one recurring group lesson occurrence (CRM scenario 1 / Prompt 1)

BEGIN;

ALTER TABLE schedule_slots
  ADD COLUMN IF NOT EXISTS moved_from_slot_id UUID,
  ADD COLUMN IF NOT EXISTS moved_from_date DATE,
  ADD COLUMN IF NOT EXISTS moved_from_time TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'schedule_slots_moved_from_slot_id_fkey'
  ) THEN
    ALTER TABLE schedule_slots
      ADD CONSTRAINT schedule_slots_moved_from_slot_id_fkey
      FOREIGN KEY (moved_from_slot_id) REFERENCES schedule_slots (id) ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION member_can_write_schedule_slot(p_slot_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_role text := current_member_role();
  v_admin_can_edit boolean;
BEGIN
  IF auth.uid() IS NULL OR auth_organization_id() IS NULL THEN
    RETURN false;
  END IF;

  IF NOT organization_allows_writes(auth_organization_id()) THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM schedule_slots ss
    WHERE ss.id = p_slot_id
      AND ss.organization_id = auth_organization_id()
  ) THEN
    RETURN false;
  END IF;

  IF v_role IN ('owner', 'director') THEN
    RETURN true;
  END IF;

  IF v_role = 'admin' THEN
    IF is_restricted_admin() THEN
      RETURN false;
    END IF;

    SELECT os.admin_can_edit_schedule
    INTO v_admin_can_edit
    FROM organization_settings os
    WHERE os.organization_id = auth_organization_id();

    RETURN COALESCE(v_admin_can_edit, true);
  END IF;

  IF v_role = 'teacher' THEN
    RETURN teacher_can_access_schedule_slot(p_slot_id);
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION schedule_location_has_conflict(
  p_org_id uuid,
  p_date date,
  p_time_start text,
  p_time_end text,
  p_location_id uuid,
  p_exclude_slot_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_time_start text;
  v_time_end text;
  v_dow integer;
BEGIN
  v_time_start := normalize_hhmm(p_time_start);
  v_time_end := normalize_hhmm(p_time_end);
  v_dow := EXTRACT(ISODOW FROM p_date)::integer;

  IF EXISTS (
    SELECT 1
    FROM personal_lessons p
    WHERE p.organization_id = p_org_id
      AND p.date = p_date
      AND p.location_id IS NOT DISTINCT FROM p_location_id
      AND schedule_time_ranges_overlap(
        p.time_start, p.time_end, v_time_start, v_time_end
      )
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM schedule_slots s
    WHERE s.organization_id = p_org_id
      AND s.day_of_week = v_dow
      AND s.location_id IS NOT DISTINCT FROM p_location_id
      AND s.id IS DISTINCT FROM p_exclude_slot_id
      AND s.valid_from <= p_date
      AND (s.valid_to IS NULL OR s.valid_to >= p_date)
      AND schedule_time_ranges_overlap(
        s.time, s.time_end, v_time_start, v_time_end
      )
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
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
    DELETE FROM schedule_slots WHERE id = p_slot.id;
    RETURN;
  END IF;

  IF p_cancel_date = v_valid_from THEN
    v_new_from := p_cancel_date + 7;
    IF v_valid_to IS NOT NULL AND v_new_from > v_valid_to THEN
      DELETE FROM schedule_slots WHERE id = p_slot.id;
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
      DELETE FROM schedule_slots WHERE id = p_slot.id;
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
    DELETE FROM schedule_slots WHERE id = p_slot.id;
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

REVOKE ALL ON FUNCTION member_can_write_schedule_slot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_can_write_schedule_slot(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION schedule_location_has_conflict(uuid, date, text, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION schedule_location_has_conflict(uuid, date, text, text, uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION move_group_lesson_occurrence(uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION move_group_lesson_occurrence(uuid, text, text, text, text) TO authenticated;

COMMIT;
