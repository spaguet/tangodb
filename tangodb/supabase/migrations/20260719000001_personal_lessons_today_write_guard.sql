-- Allow edit/delete personal lessons on current_date; block only past dates.

CREATE OR REPLACE FUNCTION delete_personal_lesson(p_lesson_id text)
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

  IF v_lesson.date < v_today THEN
    RETURN jsonb_build_object('success', false, 'error', 'Удаление недоступно для прошедших уроков');
  END IF;

  IF v_lesson.subscription_id IS NOT NULL
    AND v_lesson.attendance_status IN ('present', 'absent') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Сначала смените отметку посещаемости');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM payments p
    WHERE p.organization_id = v_org_id
      AND p.personal_lesson_id = v_lesson_uuid
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Сначала отмените оплату урока');
  END IF;

  DELETE FROM personal_lessons
  WHERE id = v_lesson_uuid
    AND organization_id = v_org_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION update_personal_lesson(
  p_lesson_id text,
  p_payload jsonb
)
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
  v_new_date date;
  v_payload jsonb := COALESCE(p_payload, '{}'::jsonb);
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

  IF v_payload = '{}'::jsonb THEN
    RETURN jsonb_build_object('success', false, 'error', 'Нет данных для обновления');
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

  IF v_lesson.date < v_today THEN
    RETURN jsonb_build_object('success', false, 'error', 'Редактирование недоступно для прошедших уроков');
  END IF;

  IF v_payload ? 'date' THEN
    BEGIN
      v_new_date := (v_payload ->> 'date')::date;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RETURN jsonb_build_object('success', false, 'error', 'Неверный формат даты');
    END;

    IF v_new_date < v_today THEN
      RETURN jsonb_build_object('success', false, 'error', 'Новая дата не может быть в прошлом');
    END IF;
  END IF;

  IF v_lesson.subscription_id IS NOT NULL
    AND v_lesson.attendance_status IN ('present', 'absent') THEN
    IF (v_payload ? 'subscription_id'
        AND NULLIF(v_payload ->> 'subscription_id', '')::uuid IS DISTINCT FROM v_lesson.subscription_id)
      OR (v_payload ? 'client_id1'
        AND NULLIF(v_payload ->> 'client_id1', '')::uuid IS DISTINCT FROM v_lesson.client_id1)
      OR (v_payload ? 'client_id2'
        AND NULLIF(v_payload ->> 'client_id2', '')::uuid IS DISTINCT FROM COALESCE(v_lesson.client_id2, NULL))
      OR (v_payload ? 'client_id3'
        AND NULLIF(v_payload ->> 'client_id3', '')::uuid IS DISTINCT FROM COALESCE(v_lesson.client_id3, NULL))
      OR (v_payload ? 'client_id4'
        AND NULLIF(v_payload ->> 'client_id4', '')::uuid IS DISTINCT FROM COALESCE(v_lesson.client_id4, NULL)) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Сначала смените отметку посещаемости');
    END IF;
  END IF;

  UPDATE personal_lessons pl
  SET
    date = CASE WHEN v_payload ? 'date' THEN (v_payload ->> 'date')::date ELSE pl.date END,
    time_start = CASE WHEN v_payload ? 'time_start' THEN v_payload ->> 'time_start' ELSE pl.time_start END,
    time_end = CASE WHEN v_payload ? 'time_end' THEN v_payload ->> 'time_end' ELSE pl.time_end END,
    location_id = CASE
      WHEN v_payload ? 'location_id' THEN NULLIF(v_payload ->> 'location_id', '')::uuid
      ELSE pl.location_id
    END,
    teacher_member_id = CASE
      WHEN v_payload ? 'teacher_member_id' THEN NULLIF(v_payload ->> 'teacher_member_id', '')::uuid
      ELSE pl.teacher_member_id
    END,
    discipline_id = CASE
      WHEN v_payload ? 'discipline_id' THEN NULLIF(v_payload ->> 'discipline_id', '')::uuid
      ELSE pl.discipline_id
    END,
    type = CASE WHEN v_payload ? 'type' THEN v_payload ->> 'type' ELSE pl.type END,
    client_id1 = CASE
      WHEN v_payload ? 'client_id1' THEN NULLIF(v_payload ->> 'client_id1', '')::uuid
      ELSE pl.client_id1
    END,
    client_id2 = CASE
      WHEN v_payload ? 'client_id2' THEN NULLIF(v_payload ->> 'client_id2', '')::uuid
      ELSE pl.client_id2
    END,
    client_id3 = CASE
      WHEN v_payload ? 'client_id3' THEN NULLIF(v_payload ->> 'client_id3', '')::uuid
      ELSE pl.client_id3
    END,
    client_id4 = CASE
      WHEN v_payload ? 'client_id4' THEN NULLIF(v_payload ->> 'client_id4', '')::uuid
      ELSE pl.client_id4
    END,
    price = CASE WHEN v_payload ? 'price' THEN (v_payload ->> 'price')::numeric ELSE pl.price END,
    paid = CASE WHEN v_payload ? 'paid' THEN v_payload ->> 'paid' ELSE pl.paid END,
    subscription_id = CASE
      WHEN v_payload ? 'subscription_id' THEN NULLIF(v_payload ->> 'subscription_id', '')::uuid
      ELSE pl.subscription_id
    END
  WHERE pl.id = v_lesson_uuid
    AND pl.organization_id = v_org_id;

  RETURN jsonb_build_object('success', true);
END;
$$;
