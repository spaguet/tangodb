-- Fix mark_attendance: v_sub must be subscriptions%ROWTYPE for resolve_subscription_freeze_policy(p_sub subscriptions).
-- Without this, marking attendance fails with "cannot cast type record to subscriptions".

CREATE OR REPLACE FUNCTION mark_attendance(
  p_date text,
  p_sub_id text,
  p_new_status text,
  p_discipline_id uuid DEFAULT NULL,
  p_schedule_group_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_role text := current_member_role();
  v_sub subscriptions%ROWTYPE;
  v_settings RECORD;
  v_old_status text;
  v_lesson_delta int := 0;
  v_freeze_delta int := 0;
  v_new_lessons_left int;
  v_new_freeze_used int;
  v_display text := '';
  v_today date := current_date;
  v_sub_uuid uuid;
  v_in_freeze_period boolean;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  PERFORM apply_scheduled_subscription_member_changes(v_org_id);
  PERFORM expire_monthly_subscriptions(v_org_id);

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Организация в режиме только чтения');
  END IF;

  IF p_date !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Неверный формат даты');
  END IF;

  IF p_date::date > v_today THEN
    RETURN jsonb_build_object('success', false, 'error', 'Отметки доступны только за прошедшие и текущий день');
  END IF;

  IF p_schedule_group_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Укажите групповой урок');
  END IF;

  IF p_new_status NOT IN ('present', 'absent', 'freeze', 'excused') THEN
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

  IF v_role = 'director' AND NOT directors_can_mark_attendance_setting() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав');
  END IF;

  IF v_role = 'teacher' AND NOT teacher_can_mark_group_attendance(p_date::date, p_schedule_group_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав для этой группы');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM subscription_groups sg
    WHERE sg.organization_id = v_org_id
      AND sg.subscription_id = v_sub_uuid
      AND sg.schedule_group_id = p_schedule_group_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Абонемент не действует для этой группы');
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

  IF v_sub.billing_model = 'monthly_unlimited' THEN
    IF p_new_status NOT IN ('present', 'absent') THEN
      RETURN jsonb_build_object('success', false, 'error', 'Для месячного абонемента доступны только присутствие и отсутствие');
    END IF;
    IF v_sub.activation_date > p_date::date THEN
      RETURN jsonb_build_object('success', false, 'error', 'Абонемент ещё не активирован');
    END IF;
    IF v_sub.expires_at < p_date::date THEN
      RETURN jsonb_build_object('success', false, 'error', 'Срок месячного абонемента истёк');
    END IF;
  END IF;

  IF v_sub.category = 'private' AND p_new_status = 'freeze' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Заморозка недоступна для персональных абонементов');
  END IF;

  IF v_sub.billing_model = 'monthly_unlimited' AND p_new_status IN ('freeze', 'excused') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Для месячного абонемента недоступны заморозка и уважительный пропуск');
  END IF;

  SELECT
    pol.freeze_enabled,
    pol.freeze_max_count,
    pol.freeze_min_lessons
  INTO v_settings
  FROM resolve_subscription_freeze_policy(v_sub) pol;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Настройки организации не найдены');
  END IF;

  IF p_new_status = 'freeze' AND NOT v_settings.freeze_enabled THEN
    RETURN jsonb_build_object('success', false, 'error', 'Заморозки отключены в настройках организации');
  END IF;

  v_in_freeze_period := subscription_active_freeze_period_id(v_org_id, v_sub_uuid, p_date::date) IS NOT NULL;

  SELECT a.attendance_status
  INTO v_old_status
  FROM attendance a
  WHERE a.date = p_date::date
    AND a.subscription_id = v_sub_uuid
    AND a.schedule_group_id = p_schedule_group_id
    AND a.organization_id = v_org_id;

  IF v_old_status IS NOT DISTINCT FROM p_new_status THEN
    RETURN jsonb_build_object(
      'success', true,
      'newLessonsLeft', v_sub.lessons_left,
      'billingModel', v_sub.billing_model,
      'expiresAt', v_sub.expires_at
    );
  END IF;

  IF v_sub.billing_model = 'lesson_count' THEN
    IF v_old_status IN ('present', 'absent') THEN
      v_lesson_delta := 1;
    END IF;
    IF v_old_status = 'freeze' AND NOT v_in_freeze_period THEN
      v_freeze_delta := -1;
    END IF;

    IF p_new_status IN ('present', 'absent') THEN
      v_lesson_delta := v_lesson_delta - 1;
    END IF;
    IF p_new_status = 'freeze' AND NOT v_in_freeze_period THEN
      v_freeze_delta := v_freeze_delta + 1;
    END IF;

    IF v_old_status IN ('present', 'absent') AND p_new_status IN ('present', 'absent') THEN
      v_lesson_delta := 0;
    END IF;

    IF v_in_freeze_period AND p_new_status IN ('present', 'absent', 'freeze') THEN
      v_lesson_delta := 0;
      v_freeze_delta := 0;
    END IF;

    IF p_new_status = 'freeze' AND NOT v_in_freeze_period THEN
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
    END IF;

    v_new_lessons_left := v_sub.lessons_left + v_lesson_delta;
    IF v_new_lessons_left < 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Недостаточно уроков');
    END IF;
    v_new_freeze_used := v_sub.freeze_used + v_freeze_delta;
  ELSE
    v_new_lessons_left := 0;
    v_new_freeze_used := v_sub.freeze_used;
  END IF;

  v_display := subscription_client_display_for_date(v_sub_uuid, p_date::date);

  INSERT INTO attendance (
    organization_id,
    date,
    subscription_id,
    schedule_group_id,
    client_display,
    attendance_status,
    freeze_period_id
  )
  VALUES (
    v_org_id,
    p_date::date,
    v_sub_uuid,
    p_schedule_group_id,
    v_display,
    CASE
      WHEN v_in_freeze_period AND p_new_status IN ('present', 'absent') THEN p_new_status
      WHEN v_in_freeze_period THEN 'freeze'
      ELSE p_new_status
    END,
    CASE
      WHEN v_in_freeze_period THEN subscription_active_freeze_period_id(v_org_id, v_sub_uuid, p_date::date)
      ELSE NULL
    END
  )
  ON CONFLICT (organization_id, date, subscription_id, schedule_group_id)
  DO UPDATE SET
    attendance_status = EXCLUDED.attendance_status,
    client_display = EXCLUDED.client_display,
    freeze_period_id = COALESCE(EXCLUDED.freeze_period_id, attendance.freeze_period_id);

  IF v_sub.billing_model = 'lesson_count' THEN
    PERFORM set_config('app.allow_subscription_counter_update', 'true', true);

    UPDATE subscriptions
    SET
      lessons_left = v_new_lessons_left,
      freeze_used = v_new_freeze_used,
      status = CASE WHEN v_new_lessons_left = 0 THEN 'finished' ELSE status END
    WHERE id = v_sub_uuid
      AND organization_id = v_org_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'newLessonsLeft', v_new_lessons_left,
    'billingModel', v_sub.billing_model,
    'expiresAt', v_sub.expires_at
  );
END;
$$;
