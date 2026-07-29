-- Schedule cancellation log, teacher vacation RPC, refactor batch cancel helpers

BEGIN;

CREATE TABLE IF NOT EXISTS schedule_occurrence_cancellations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  slot_id UUID REFERENCES schedule_slots (id) ON DELETE SET NULL,
  teacher_member_id UUID REFERENCES organization_members (id) ON DELETE SET NULL,
  class_id UUID REFERENCES classes (id) ON DELETE SET NULL,
  discipline_id UUID REFERENCES disciplines (id) ON DELETE SET NULL,
  location_id UUID REFERENCES locations (id) ON DELETE SET NULL,
  group_name TEXT,
  occurrence_date DATE NOT NULL,
  time TEXT NOT NULL,
  time_end TEXT NOT NULL,
  cancelled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_by UUID REFERENCES auth.users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_schedule_cancellations_org_date
  ON schedule_occurrence_cancellations (organization_id, occurrence_date);

CREATE INDEX IF NOT EXISTS idx_schedule_cancellations_org_teacher_date
  ON schedule_occurrence_cancellations (organization_id, teacher_member_id, occurrence_date);

ALTER TABLE schedule_occurrence_cancellations ENABLE ROW LEVEL SECURITY;

CREATE POLICY schedule_cancellations_select_operational
  ON schedule_occurrence_cancellations FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_operational()
  );

CREATE POLICY schedule_cancellations_select_teacher
  ON schedule_occurrence_cancellations FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND current_member_role() = 'teacher'
    AND teacher_member_id = auth_member_id()
  );

GRANT SELECT ON schedule_occurrence_cancellations TO authenticated;
GRANT SELECT, INSERT ON schedule_occurrence_cancellations TO service_role;

CREATE OR REPLACE FUNCTION member_can_cancel_teacher_vacation(p_teacher_member_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_role text := current_member_role();
  v_admin_can_edit boolean;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN false;
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM organization_members om
    WHERE om.id = p_teacher_member_id
      AND om.organization_id = v_org_id
      AND om.is_active
  ) THEN
    RETURN false;
  END IF;

  IF v_role = 'teacher' THEN
    RETURN p_teacher_member_id = auth_member_id();
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
    WHERE os.organization_id = v_org_id;

    RETURN COALESCE(v_admin_can_edit, true);
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION _group_slot_occurrences_in_range(
  p_slot schedule_slots,
  p_range_start date,
  p_range_end date
)
RETURNS date[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_dates date[] := ARRAY[]::date[];
  v_current date;
  v_valid_from date := COALESCE(p_slot.valid_from, DATE '2000-01-01');
  v_valid_to date := p_slot.valid_to;
BEGIN
  IF p_range_end < p_range_start THEN
    RETURN v_dates;
  END IF;

  IF p_slot.valid_to IS NOT NULL AND p_slot.valid_to <= p_slot.valid_from THEN
    RETURN v_dates;
  END IF;

  IF v_valid_to IS NOT NULL AND p_range_start > v_valid_to THEN
    RETURN v_dates;
  END IF;

  IF p_range_end < v_valid_from THEN
    RETURN v_dates;
  END IF;

  v_current := p_range_start;
  WHILE EXTRACT(ISODOW FROM v_current)::integer <> p_slot.day_of_week LOOP
    v_current := v_current + 1;
    IF v_current > p_range_end THEN
      RETURN v_dates;
    END IF;
  END LOOP;

  WHILE v_current <= p_range_end LOOP
    IF _is_group_slot_occurrence_date(p_slot, v_current) THEN
      v_dates := array_append(v_dates, v_current);
    END IF;
    v_current := v_current + 7;
  END LOOP;

  RETURN v_dates;
END;
$$;

CREATE OR REPLACE FUNCTION _record_schedule_cancellations(
  p_slot schedule_slots,
  p_dates date[]
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, auth
AS $$
BEGIN
  IF p_dates IS NULL OR array_length(p_dates, 1) IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO schedule_occurrence_cancellations (
    organization_id,
    slot_id,
    teacher_member_id,
    class_id,
    discipline_id,
    location_id,
    group_name,
    occurrence_date,
    time,
    time_end,
    cancelled_by
  )
  SELECT
    p_slot.organization_id,
    p_slot.id,
    p_slot.teacher_member_id,
    p_slot.class_id,
    p_slot.discipline_id,
    p_slot.location_id,
    p_slot.group_name,
    d,
    p_slot.time,
    p_slot.time_end,
    auth.uid()
  FROM unnest(p_dates) AS d;
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
    DELETE FROM schedule_slots WHERE id = p_slot_id;
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
    DELETE FROM schedule_slots WHERE id = p_slot_id;

    v_first_segment := true;
    FOR v_seg_from, v_seg_to IN
      SELECT valid_from, valid_to FROM _cancel_segments ORDER BY valid_from
    LOOP
      IF v_first_segment THEN
        INSERT INTO schedule_slots (
          id,
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
          p_slot_id,
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

CREATE OR REPLACE FUNCTION cancel_group_lesson_occurrences(
  p_slot_id uuid,
  p_cancel_dates text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_slot schedule_slots%ROWTYPE;
  v_cancel_text text;
  v_cancel date;
  v_cancel_dates date[] := ARRAY[]::date[];
  v_sorted date[];
  v_valid_count integer;
  v_cancelled integer;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.orgReadOnly');
  END IF;

  IF NOT member_can_write_schedule_slot(p_slot_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.cancelForbidden');
  END IF;

  IF p_cancel_dates IS NULL OR array_length(p_cancel_dates, 1) IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.cancelDatesEmpty');
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
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.cancelNotRecurring');
  END IF;

  FOREACH v_cancel_text IN ARRAY p_cancel_dates LOOP
    IF v_cancel_text IS NULL OR v_cancel_text !~ '^\d{4}-\d{2}-\d{2}$' THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.error.cancelDateInvalid');
    END IF;

    BEGIN
      v_cancel := v_cancel_text::date;
    EXCEPTION
      WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', 'schedule.error.cancelDateInvalid');
    END;

    IF v_cancel = ANY (v_cancel_dates) THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.error.cancelDatesDuplicate');
    END IF;

    v_cancel_dates := array_append(v_cancel_dates, v_cancel);
  END LOOP;

  SELECT count(*)
  INTO v_valid_count
  FROM unnest(v_cancel_dates) AS d
  WHERE _is_group_slot_occurrence_date(v_slot, d);

  IF v_valid_count = 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'cancelled_count', 0,
      'already_applied', true
    );
  END IF;

  IF v_valid_count <> array_length(v_cancel_dates, 1) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.cancelDateInvalid');
  END IF;

  SELECT array_agg(d ORDER BY d)
  INTO v_sorted
  FROM unnest(v_cancel_dates) AS d;

  PERFORM _record_schedule_cancellations(v_slot, v_sorted);
  v_cancelled := _apply_group_slot_cancellations_locked(p_slot_id, v_sorted);

  RETURN jsonb_build_object(
    'success', true,
    'cancelled_count', v_cancelled
  );
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
  WHEN OTHERS THEN
    RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION cancel_teacher_group_vacation(
  p_teacher_member_id uuid,
  p_start_date text,
  p_end_date text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_start date;
  v_end date;
  v_slot schedule_slots%ROWTYPE;
  v_dates date[];
  v_sorted date[];
  v_total integer := 0;
  v_slot_count integer := 0;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.orgReadOnly');
  END IF;

  IF NOT member_can_cancel_teacher_vacation(p_teacher_member_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.vacationForbidden');
  END IF;

  IF p_start_date !~ '^\d{4}-\d{2}-\d{2}$' OR p_end_date !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.vacationInvalidRange');
  END IF;

  v_start := p_start_date::date;
  v_end := p_end_date::date;

  IF v_end < v_start THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.vacationInvalidRange');
  END IF;

  FOR v_slot IN
    SELECT *
    FROM schedule_slots ss
    WHERE ss.organization_id = v_org_id
      AND ss.teacher_member_id = p_teacher_member_id
      AND (ss.valid_to IS NULL OR ss.valid_to > ss.valid_from)
      AND ss.valid_from <= v_end
      AND (ss.valid_to IS NULL OR ss.valid_to >= v_start)
    ORDER BY ss.id
    FOR UPDATE
  LOOP
    v_dates := _group_slot_occurrences_in_range(v_slot, v_start, v_end);

    IF v_dates IS NULL OR array_length(v_dates, 1) IS NULL THEN
      CONTINUE;
    END IF;

    IF NOT member_can_write_schedule_slot(v_slot.id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.error.vacationForbidden');
    END IF;

    SELECT array_agg(d ORDER BY d)
    INTO v_sorted
    FROM unnest(v_dates) AS d;

    PERFORM _record_schedule_cancellations(v_slot, v_sorted);
    v_total := v_total + _apply_group_slot_cancellations_locked(v_slot.id, v_sorted);
    v_slot_count := v_slot_count + 1;
  END LOOP;

  IF v_total = 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'cancelled_count', 0,
      'series_count', 0,
      'already_applied', true
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'cancelled_count', v_total,
    'series_count', v_slot_count
  );
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
  WHEN OTHERS THEN
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION member_can_cancel_teacher_vacation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_can_cancel_teacher_vacation(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION cancel_teacher_group_vacation(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_teacher_group_vacation(uuid, text, text) TO authenticated;

COMMIT;
