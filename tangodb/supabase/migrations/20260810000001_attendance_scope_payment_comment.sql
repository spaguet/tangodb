-- Teacher group attendance scope, payment method comment, personal-lesson sales toggle, director attendance access

BEGIN;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS method_comment TEXT;

ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS teachers_can_sell_personal_lessons BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS directors_can_mark_attendance BOOLEAN NOT NULL DEFAULT true;

-- =============================================================================
-- Teacher scope: schedule groups (classes)
-- =============================================================================

CREATE OR REPLACE FUNCTION teacher_has_schedule_group_access(p_schedule_group_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_scope jsonb := auth_teacher_scope();
BEGIN
  IF p_schedule_group_id IS NULL THEN
    RETURN false;
  END IF;

  IF COALESCE((v_scope ->> 'all_groups')::boolean, false) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(COALESCE(v_scope -> 'schedule_group_ids', '[]'::jsonb)) AS elem
    WHERE elem::uuid = p_schedule_group_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION directors_can_mark_attendance_setting()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    (
      SELECT os.directors_can_mark_attendance
      FROM organization_settings os
      WHERE os.organization_id = auth_organization_id()
    ),
    true
  );
$$;

CREATE OR REPLACE FUNCTION member_can_access_attendance_journal()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    CASE current_member_role()
      WHEN 'owner' THEN true
      WHEN 'director' THEN directors_can_mark_attendance_setting()
      WHEN 'admin' THEN can_read_operational()
      WHEN 'teacher' THEN true
      ELSE can_write_reception()
    END;
$$;

CREATE OR REPLACE FUNCTION teacher_can_mark_group_attendance(
  p_date date,
  p_schedule_group_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_dow int;
BEGIN
  IF NOT teacher_has_schedule_group_access(p_schedule_group_id) THEN
    RETURN false;
  END IF;

  v_dow := EXTRACT(ISODOW FROM p_date)::int;

  RETURN EXISTS (
    SELECT 1
    FROM schedule_slots ss
    WHERE ss.organization_id = auth_organization_id()
      AND ss.class_id = p_schedule_group_id
      AND ss.teacher_member_id = auth_member_id()
      AND ss.day_of_week = v_dow
      AND COALESCE(ss.valid_from, DATE '2000-01-01') <= p_date
      AND (ss.valid_to IS NULL OR ss.valid_to >= p_date)
  );
END;
$$;

CREATE OR REPLACE FUNCTION teacher_can_view_attendance_row(
  p_date date,
  p_schedule_group_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  RETURN teacher_can_mark_group_attendance(p_date, p_schedule_group_id);
END;
$$;

-- =============================================================================
-- mark_attendance — patch permission checks (body unchanged from v3)
-- =============================================================================

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
    os.freeze_max_count,
    os.freeze_min_lessons,
    os.freeze_deducts_lesson
  INTO v_settings
  FROM organization_settings os
  WHERE os.organization_id = v_org_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Настройки организации не найдены');
  END IF;

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
  ELSE
    v_new_lessons_left := 0;
    v_new_freeze_used := v_sub.freeze_used;
  END IF;

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
    organization_id,
    date,
    subscription_id,
    schedule_group_id,
    client_display,
    attendance_status
  )
  VALUES (
    v_org_id,
    p_date::date,
    v_sub_uuid,
    p_schedule_group_id,
    v_display,
    p_new_status
  )
  ON CONFLICT (organization_id, date, subscription_id, schedule_group_id)
  DO UPDATE SET
    attendance_status = EXCLUDED.attendance_status,
    client_display = EXCLUDED.client_display;

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

-- =============================================================================
-- mark_personal_lesson_attendance — patch permission checks
-- =============================================================================

CREATE OR REPLACE FUNCTION mark_personal_lesson_attendance(
  p_lesson_id text,
  p_new_status text
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
  v_sub RECORD;
  v_today date := current_date;
  v_lesson_uuid uuid;
  v_old_status text;
  v_lesson_delta int := 0;
  v_new_lessons_left int;
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

  IF p_new_status NOT IN ('present', 'absent', 'excused') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недопустимый статус');
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

  IF v_role = 'director' AND NOT directors_can_mark_attendance_setting() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав');
  END IF;

  IF v_role = 'teacher' AND v_lesson.teacher_member_id IS DISTINCT FROM auth_member_id() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав для этого урока');
  END IF;

  IF v_lesson.date > v_today THEN
    RETURN jsonb_build_object('success', false, 'error', 'Отметки доступны только за прошедшие и текущий день');
  END IF;

  v_old_status := v_lesson.attendance_status;

  IF v_old_status IS NOT DISTINCT FROM p_new_status THEN
    IF v_lesson.subscription_id IS NOT NULL THEN
      SELECT lessons_left INTO v_new_lessons_left
      FROM subscriptions
      WHERE id = v_lesson.subscription_id
        AND organization_id = v_org_id;
      RETURN jsonb_build_object('success', true, 'newLessonsLeft', v_new_lessons_left);
    END IF;
    RETURN jsonb_build_object('success', true);
  END IF;

  IF v_lesson.subscription_id IS NOT NULL THEN
    SELECT * INTO v_sub
    FROM subscriptions
    WHERE id = v_lesson.subscription_id
      AND organization_id = v_org_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Пакет не найден');
    END IF;

    IF v_old_status IN ('present', 'absent') THEN
      v_lesson_delta := 1;
    END IF;

    IF p_new_status IN ('present', 'absent') THEN
      v_lesson_delta := v_lesson_delta - 1;
    END IF;

    IF v_old_status IN ('present', 'absent') AND p_new_status IN ('present', 'absent') THEN
      v_lesson_delta := 0;
    END IF;

    v_new_lessons_left := v_sub.lessons_left + v_lesson_delta;

    IF v_new_lessons_left < 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Недостаточно уроков в пакете');
    END IF;

    UPDATE personal_lessons
    SET attendance_status = p_new_status
    WHERE id = v_lesson_uuid
      AND organization_id = v_org_id;

    PERFORM set_config('app.allow_subscription_counter_update', 'true', true);

    UPDATE subscriptions
    SET
      lessons_left = v_new_lessons_left,
      status = CASE WHEN v_new_lessons_left = 0 THEN 'finished' ELSE status END
    WHERE id = v_sub.id
      AND organization_id = v_org_id;

    RETURN jsonb_build_object('success', true, 'newLessonsLeft', v_new_lessons_left);
  END IF;

  UPDATE personal_lessons
  SET attendance_status = p_new_status
  WHERE id = v_lesson_uuid
    AND organization_id = v_org_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- =============================================================================
-- record_subscription_payment — optional method comment (required for "other")
-- =============================================================================

DROP FUNCTION IF EXISTS record_subscription_payment(uuid, numeric, text);

CREATE OR REPLACE FUNCTION record_subscription_payment(
  p_subscription_id uuid,
  p_amount numeric,
  p_method text DEFAULT 'cash',
  p_method_comment text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_role text := current_member_role();
  v_sub subscriptions%ROWTYPE;
  v_client_display text;
  v_comment text := nullif(trim(coalesce(p_method_comment, '')), '');
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Организация в режиме только чтения');
  END IF;

  IF NOT member_can_accept_payments() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Нет прав на запись платежа');
  END IF;

  IF p_method NOT IN ('cash', 'transfer', 'card', 'other') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недопустимый способ оплаты');
  END IF;

  IF p_method = 'other' AND v_comment IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Укажите способ оплаты или взаимозачёта');
  END IF;

  IF p_amount IS NULL OR p_amount < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Сумма должна быть неотрицательной');
  END IF;

  SELECT * INTO v_sub
  FROM subscriptions s
  WHERE s.id = p_subscription_id
    AND s.organization_id = v_org_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Абонемент не найден');
  END IF;

  IF v_role = 'teacher' AND NOT teacher_can_access_subscription(p_subscription_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Нет доступа к этому абонементу');
  END IF;

  IF v_sub.client_id1 IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'У абонемента не указан клиент');
  END IF;

  SELECT trim(coalesce(c.last_name, '') || ' ' || coalesce(c.first_name, ''))
  INTO v_client_display
  FROM clients c
  WHERE c.organization_id = v_org_id
    AND c.id = v_sub.client_id1;

  PERFORM set_config('row_security', 'off', true);

  INSERT INTO payments (
    organization_id,
    client_id,
    client_display,
    amount,
    method,
    method_comment,
    subscription_id,
    created_by,
    created_at
  )
  VALUES (
    v_org_id,
    v_sub.client_id1,
    coalesce(nullif(v_client_display, ''), 'Клиент'),
    p_amount,
    p_method,
    v_comment,
    v_sub.id,
    v_member_id,
    now()
  )
  ON CONFLICT (organization_id, subscription_id)
    WHERE subscription_id IS NOT NULL AND personal_lesson_id IS NULL
  DO NOTHING;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- =============================================================================
-- Attendance RLS — teacher sees only own assigned groups in scope
-- =============================================================================

DROP POLICY IF EXISTS attendance_select_teacher ON attendance;
DROP POLICY IF EXISTS attendance_write_teacher ON attendance;

CREATE POLICY attendance_select_teacher
  ON attendance FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND current_member_role() = 'teacher'
    AND teacher_can_view_attendance_row(date, schedule_group_id)
  );

CREATE POLICY attendance_write_teacher
  ON attendance FOR ALL TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND current_member_role() = 'teacher'
    AND teacher_can_view_attendance_row(date, schedule_group_id)
  )
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND current_member_role() = 'teacher'
    AND teacher_can_view_attendance_row(date, schedule_group_id)
  );

REVOKE ALL ON FUNCTION teacher_has_schedule_group_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION teacher_has_schedule_group_access(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION directors_can_mark_attendance_setting() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION directors_can_mark_attendance_setting() TO authenticated, service_role;

REVOKE ALL ON FUNCTION member_can_access_attendance_journal() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION member_can_access_attendance_journal() TO authenticated, service_role;

REVOKE ALL ON FUNCTION teacher_can_mark_group_attendance(date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION teacher_can_mark_group_attendance(date, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION teacher_can_view_attendance_row(date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION teacher_can_view_attendance_row(date, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION record_subscription_payment(uuid, numeric, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_subscription_payment(uuid, numeric, text, text) TO authenticated;

COMMIT;
