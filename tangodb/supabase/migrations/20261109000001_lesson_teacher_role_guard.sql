-- Only owner, director, and teacher may be assigned as lesson conducting teachers.

CREATE OR REPLACE FUNCTION member_can_conduct_lessons(
  p_org_id uuid,
  p_member_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM organization_members om
    WHERE om.organization_id = p_org_id
      AND om.id = p_member_id
      AND om.is_active = true
      AND om.role IN ('owner', 'director', 'teacher')
  );
$$;

CREATE OR REPLACE FUNCTION assert_lesson_teacher_member_role()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.teacher_member_id IS NOT NULL
    AND NOT member_can_conduct_lessons(NEW.organization_id, NEW.teacher_member_id)
  THEN
    RAISE EXCEPTION 'schedule.error.teacherRole'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_schedule_slots_lesson_teacher_role ON schedule_slots;
CREATE TRIGGER trg_schedule_slots_lesson_teacher_role
  BEFORE INSERT OR UPDATE OF teacher_member_id
  ON schedule_slots
  FOR EACH ROW
  EXECUTE FUNCTION assert_lesson_teacher_member_role();

DROP TRIGGER IF EXISTS trg_personal_lessons_lesson_teacher_role ON personal_lessons;
CREATE TRIGGER trg_personal_lessons_lesson_teacher_role
  BEFORE INSERT OR UPDATE OF teacher_member_id
  ON personal_lessons
  FOR EACH ROW
  EXECUTE FUNCTION assert_lesson_teacher_member_role();

DROP TRIGGER IF EXISTS trg_single_visits_lesson_teacher_role ON single_visits;
CREATE TRIGGER trg_single_visits_lesson_teacher_role
  BEFORE INSERT OR UPDATE OF teacher_member_id
  ON single_visits
  FOR EACH ROW
  EXECUTE FUNCTION assert_lesson_teacher_member_role();

CREATE OR REPLACE FUNCTION assign_lesson_substitute(
  p_occurrence_kind text,
  p_occurrence_date date,
  p_schedule_slot_id uuid,
  p_personal_lesson_id uuid,
  p_substitute_member_id uuid,
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_actor uuid := auth_member_id();
  v_fingerprint text;
  v_cached jsonb;
  v_slot schedule_slots%ROWTYPE;
  v_lesson personal_lessons%ROWTYPE;
  v_original uuid;
  v_time_start text;
  v_time_end text;
  v_existing uuid;
  v_id uuid;
  v_result jsonb;
BEGIN
  v_fingerprint := md5(concat_ws('|',
    p_occurrence_kind,
    p_occurrence_date::text,
    COALESCE(p_schedule_slot_id::text, ''),
    COALESCE(p_personal_lesson_id::text, ''),
    p_substitute_member_id::text
  ));
  v_cached := check_operation_idempotency(
    v_org_id, 'assign_lesson_substitute', p_idempotency_key, v_fingerprint
  );
  IF v_cached IS NOT NULL THEN
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.substitute.error.unauthorized');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.substitute.error.readOnly');
  END IF;

  IF p_occurrence_kind NOT IN ('group', 'personal') OR p_occurrence_date IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.substitute.error.invalid');
  END IF;

  IF p_occurrence_kind = 'group' THEN
    IF p_schedule_slot_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.substitute.error.notFound');
    END IF;
    SELECT * INTO v_slot
    FROM schedule_slots ss
    WHERE ss.id = p_schedule_slot_id AND ss.organization_id = v_org_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.substitute.error.notFound');
    END IF;
    IF v_slot.day_of_week <> EXTRACT(ISODOW FROM p_occurrence_date)::integer
      OR v_slot.valid_from > p_occurrence_date
      OR (v_slot.valid_to IS NOT NULL AND v_slot.valid_to < p_occurrence_date)
    THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.substitute.error.notFound');
    END IF;
    IF EXISTS (
      SELECT 1 FROM schedule_occurrence_cancellations soc
      WHERE soc.organization_id = v_org_id
        AND soc.slot_id = v_slot.id
        AND soc.occurrence_date = p_occurrence_date
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.substitute.error.cancelled');
    END IF;
    v_original := v_slot.teacher_member_id;
    v_time_start := v_slot.time;
    v_time_end := v_slot.time_end;
  ELSE
    IF p_personal_lesson_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.substitute.error.notFound');
    END IF;
    SELECT * INTO v_lesson
    FROM personal_lessons pl
    WHERE pl.id = p_personal_lesson_id AND pl.organization_id = v_org_id;
    IF NOT FOUND OR v_lesson.cancelled_at IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.substitute.error.notFound');
    END IF;
    IF v_lesson.date IS DISTINCT FROM p_occurrence_date THEN
      RETURN jsonb_build_object('success', false, 'error', 'schedule.substitute.error.invalid');
    END IF;
    v_original := v_lesson.teacher_member_id;
    v_time_start := v_lesson.time_start;
    v_time_end := v_lesson.time_end;
  END IF;

  IF v_original IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.substitute.error.noRegularTeacher');
  END IF;

  IF NOT member_can_assign_lesson_substitute(v_original) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.substitute.error.forbidden');
  END IF;

  IF p_substitute_member_id IS NULL OR p_substitute_member_id = v_original THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.substitute.error.self');
  END IF;

  IF NOT member_can_conduct_lessons(v_org_id, p_substitute_member_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.substitute.error.invalidTeacher');
  END IF;

  IF teacher_has_conducting_overlap(
    v_org_id,
    p_substitute_member_id,
    p_occurrence_date,
    v_time_start,
    v_time_end,
    CASE WHEN p_occurrence_kind = 'group' THEN v_slot.id ELSE NULL END,
    CASE WHEN p_occurrence_kind = 'personal' THEN v_lesson.id ELSE NULL END
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.substitute.error.overlap');
  END IF;

  SELECT s.id INTO v_existing
  FROM lesson_occurrence_substitutes s
  WHERE s.organization_id = v_org_id
    AND s.occurrence_kind = p_occurrence_kind
    AND s.occurrence_date = p_occurrence_date
    AND (
      (p_occurrence_kind = 'group' AND s.schedule_slot_id = v_slot.id)
      OR (p_occurrence_kind = 'personal' AND s.personal_lesson_id = v_lesson.id)
    );

  IF v_existing IS NOT NULL THEN
    UPDATE lesson_occurrence_substitutes
    SET
      substitute_teacher_member_id = p_substitute_member_id,
      original_teacher_member_id = v_original,
      created_by = v_actor
    WHERE id = v_existing AND organization_id = v_org_id
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO lesson_occurrence_substitutes (
      organization_id,
      occurrence_kind,
      occurrence_date,
      schedule_slot_id,
      personal_lesson_id,
      original_teacher_member_id,
      substitute_teacher_member_id,
      created_by
    ) VALUES (
      v_org_id,
      p_occurrence_kind,
      p_occurrence_date,
      CASE WHEN p_occurrence_kind = 'group' THEN v_slot.id ELSE NULL END,
      CASE WHEN p_occurrence_kind = 'personal' THEN v_lesson.id ELSE NULL END,
      v_original,
      p_substitute_member_id,
      v_actor
    )
    RETURNING id INTO v_id;
  END IF;

  PERFORM sync_substitute_conducting_records(
    v_org_id,
    p_occurrence_kind,
    CASE WHEN p_occurrence_kind = 'group' THEN v_slot.id ELSE NULL END,
    CASE WHEN p_occurrence_kind = 'personal' THEN v_lesson.id ELSE NULL END,
    p_occurrence_date,
    p_substitute_member_id
  );

  IF p_occurrence_kind = 'group' THEN
    PERFORM enqueue_calendar_sync(v_org_id, 'group_occurrence', v_slot.id, p_occurrence_date, 'upsert');
  ELSE
    PERFORM enqueue_calendar_sync(v_org_id, 'personal_lesson', v_lesson.id, p_occurrence_date, 'upsert');
  END IF;

  v_result := jsonb_build_object(
    'success', true,
    'substitute_id', v_id,
    'original_teacher_member_id', v_original,
    'substitute_teacher_member_id', p_substitute_member_id
  );
  PERFORM store_operation_idempotency(
    v_org_id, 'assign_lesson_substitute', p_idempotency_key, v_fingerprint, v_result
  );
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION member_can_conduct_lessons(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_can_conduct_lessons(uuid, uuid)
  TO authenticated, service_role;
