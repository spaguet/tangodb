-- Delete personal lesson and all future occurrences in the same weekly series (matched by clients, time, teacher, location, discipline, weekday).

CREATE OR REPLACE FUNCTION delete_personal_lesson_series_from_date(p_lesson_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_role text := current_member_role();
  v_lesson RECORD;
  v_today date := current_date;
  v_lesson_uuid uuid;
  v_target RECORD;
  v_deleted int := 0;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Организация в режиме только чтения');
  END IF;

  IF p_lesson_id IS NULL OR trim(p_lesson_id) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не указан идентификатор урока');
  END IF;

  BEGIN
    v_lesson_uuid := p_lesson_id::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RETURN jsonb_build_object('success', false, 'error', 'Урок не найден');
  END;

  SELECT * INTO v_lesson
  FROM personal_lessons
  WHERE id = v_lesson_uuid
    AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Урок не найден');
  END IF;

  IF v_role = 'accountant' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав');
  END IF;

  IF v_role = 'teacher' AND NOT teacher_can_access_lesson(v_lesson_uuid) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав для этого урока');
  END IF;

  FOR v_target IN
    SELECT pl.*
    FROM personal_lessons pl
    WHERE pl.organization_id = v_org_id
      AND pl.date >= v_lesson.date
      AND pl.type = v_lesson.type
      AND pl.client_id1 IS NOT DISTINCT FROM v_lesson.client_id1
      AND pl.client_id2 IS NOT DISTINCT FROM v_lesson.client_id2
      AND pl.client_id3 IS NOT DISTINCT FROM v_lesson.client_id3
      AND pl.client_id4 IS NOT DISTINCT FROM v_lesson.client_id4
      AND pl.time_start = v_lesson.time_start
      AND pl.time_end = v_lesson.time_end
      AND pl.teacher_member_id IS NOT DISTINCT FROM v_lesson.teacher_member_id
      AND pl.location_id IS NOT DISTINCT FROM v_lesson.location_id
      AND pl.discipline_id IS NOT DISTINCT FROM v_lesson.discipline_id
      AND EXTRACT(ISODOW FROM pl.date) = EXTRACT(ISODOW FROM v_lesson.date)
    ORDER BY pl.date
    FOR UPDATE
  LOOP
    IF v_role = 'teacher' AND NOT teacher_can_access_lesson(v_target.id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав для этого урока');
    END IF;

    IF v_target.date < v_today AND NOT can_edit_past_schedule() THEN
      RETURN jsonb_build_object('success', false, 'error', 'Удаление недоступно для прошедших уроков');
    END IF;

    IF v_target.subscription_id IS NOT NULL
      AND v_target.attendance_status IN ('present', 'absent') THEN
      RETURN jsonb_build_object('success', false, 'error', 'Сначала смените отметку посещаемости');
    END IF;

    IF EXISTS (
      SELECT 1
      FROM payments p
      WHERE p.organization_id = v_org_id
        AND p.personal_lesson_id = v_target.id
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Сначала отмените оплату урока');
    END IF;
  END LOOP;

  DELETE FROM personal_lessons pl
  WHERE pl.organization_id = v_org_id
    AND pl.date >= v_lesson.date
    AND pl.type = v_lesson.type
    AND pl.client_id1 IS NOT DISTINCT FROM v_lesson.client_id1
    AND pl.client_id2 IS NOT DISTINCT FROM v_lesson.client_id2
    AND pl.client_id3 IS NOT DISTINCT FROM v_lesson.client_id3
    AND pl.client_id4 IS NOT DISTINCT FROM v_lesson.client_id4
    AND pl.time_start = v_lesson.time_start
    AND pl.time_end = v_lesson.time_end
    AND pl.teacher_member_id IS NOT DISTINCT FROM v_lesson.teacher_member_id
    AND pl.location_id IS NOT DISTINCT FROM v_lesson.location_id
    AND pl.discipline_id IS NOT DISTINCT FROM v_lesson.discipline_id
    AND EXTRACT(ISODOW FROM pl.date) = EXTRACT(ISODOW FROM v_lesson.date);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'deleted_count', v_deleted);
END;
$$;

REVOKE ALL ON FUNCTION delete_personal_lesson_series_from_date(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_personal_lesson_series_from_date(text) TO authenticated;
