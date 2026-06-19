-- Group subscriptions: optional discipline guard when marking attendance from a group lesson journal.

DROP FUNCTION IF EXISTS mark_attendance(text, text, text);

CREATE OR REPLACE FUNCTION mark_attendance(
  p_date text,
  p_sub_id text,
  p_new_status text,
  p_discipline_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_role text := current_member_role();
  v_sub RECORD;
  v_settings RECORD;
  v_old_status text;
  v_lesson_delta int := 0;
  v_freeze_delta int := 0;
  v_new_lessons_left int;
  v_new_freeze_used int;
  v_display text := '';
  v_c1 record;
  v_c2 record;
  v_c3 record;
  v_today date := current_date;
  v_sub_uuid uuid;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Организация в режиме только чтения');
  END IF;

  IF p_date !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Неверный формат даты');
  END IF;

  IF p_date::date > v_today THEN
    RETURN jsonb_build_object('success', false, 'error', 'Отметки доступны только за прошедшие и текущий день');
  END IF;

  IF p_new_status NOT IN ('present', 'absent', 'freeze') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недопустимый статус');
  END IF;

  BEGIN
    v_sub_uuid := p_sub_id::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RETURN jsonb_build_object('success', false, 'error', 'Абонемент не найден');
  END;

  SELECT * INTO v_sub
  FROM subscriptions
  WHERE id = v_sub_uuid
    AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Абонемент не найден');
  END IF;

  IF v_role = 'accountant' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав');
  END IF;

  IF v_role = 'teacher' AND NOT teacher_can_access_subscription(v_sub_uuid) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав для этого абонемента');
  END IF;

  IF p_discipline_id IS NOT NULL
    AND v_sub.category = 'group'
    AND v_sub.discipline_id IS NOT NULL
    AND v_sub.discipline_id <> p_discipline_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Абонемент действует только для групповых уроков выбранного направления'
    );
  END IF;

  SELECT
    os.freeze_max_count,
    os.freeze_min_lessons,
    os.freeze_deducts_lesson
  INTO v_settings
  FROM organization_settings os
  WHERE os.organization_id = v_org_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Настройки организации не найдены');
  END IF;

  IF v_sub.category = 'private' AND p_new_status = 'freeze' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Заморозка недоступна для персональных абонементов');
  END IF;

  SELECT a.attendance_status
  INTO v_old_status
  FROM attendance a
  WHERE a.date = p_date::date
    AND a.subscription_id = v_sub_uuid
    AND a.organization_id = v_org_id;

  IF v_old_status IS NOT DISTINCT FROM p_new_status THEN
    RETURN jsonb_build_object('success', true, 'newLessonsLeft', v_sub.lessons_left);
  END IF;

  IF v_old_status IN ('present', 'absent') THEN
    v_lesson_delta := 1;
  END IF;
  IF v_old_status = 'freeze' THEN
    v_freeze_delta := -1;
  END IF;

  IF p_new_status IN ('present', 'absent') THEN
    v_lesson_delta := v_lesson_delta - 1;
  END IF;
  IF p_new_status = 'freeze' THEN
    v_freeze_delta := v_freeze_delta + 1;
  END IF;

  IF v_old_status IN ('present', 'absent') AND p_new_status IN ('present', 'absent') THEN
    v_lesson_delta := 0;
  END IF;

  IF p_new_status = 'freeze' THEN
    IF v_sub.lessons_total < v_settings.freeze_min_lessons THEN
      RETURN jsonb_build_object(
        'success', false,
        'error',
        format('Заморозка только для абонементов от %s уроков', v_settings.freeze_min_lessons)
      );
    END IF;
    IF v_sub.freeze_used + v_freeze_delta > v_settings.freeze_max_count THEN
      RETURN jsonb_build_object('success', false, 'error', 'Лимит заморозок исчерпан');
    END IF;
    IF NOT v_settings.freeze_deducts_lesson THEN
      v_lesson_delta := 0;
    END IF;
  END IF;

  v_new_lessons_left := v_sub.lessons_left + v_lesson_delta;
  IF v_new_lessons_left < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно уроков');
  END IF;
  v_new_freeze_used := v_sub.freeze_used + v_freeze_delta;

  SELECT last_name, first_name INTO v_c1 FROM clients WHERE id = v_sub.client_id1;
  IF FOUND THEN
    v_display := v_c1.last_name || ' ' || v_c1.first_name;
  ELSE
    v_display := v_sub.client_id1::text;
  END IF;

  IF v_sub.client_id2 IS NOT NULL THEN
    SELECT last_name, first_name INTO v_c2 FROM clients WHERE id = v_sub.client_id2;
    IF FOUND THEN
      v_display := v_display || ' & ' || v_c2.last_name || ' ' || v_c2.first_name;
    END IF;
  END IF;

  IF v_sub.client_id3 IS NOT NULL THEN
    SELECT last_name, first_name INTO v_c3 FROM clients WHERE id = v_sub.client_id3;
    IF FOUND THEN
      v_display := v_display || ' & ' || v_c3.last_name || ' ' || v_c3.first_name;
    END IF;
  END IF;

  INSERT INTO attendance (
    organization_id, date, subscription_id, client_display, attendance_status
  )
  VALUES (v_org_id, p_date::date, v_sub_uuid, v_display, p_new_status)
  ON CONFLICT (organization_id, date, subscription_id)
  DO UPDATE SET
    attendance_status = EXCLUDED.attendance_status,
    client_display = EXCLUDED.client_display;

  PERFORM set_config('app.allow_subscription_counter_update', 'true', true);

  UPDATE subscriptions
  SET
    lessons_left = v_new_lessons_left,
    freeze_used = v_new_freeze_used,
    status = CASE WHEN v_new_lessons_left = 0 THEN 'finished' ELSE status END
  WHERE id = v_sub_uuid
    AND organization_id = v_org_id;

  RETURN jsonb_build_object('success', true, 'newLessonsLeft', v_new_lessons_left);
END;
$$;

REVOKE ALL ON FUNCTION mark_attendance(text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_attendance(text, text, text, uuid) FROM authenticated;
