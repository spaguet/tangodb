-- TangoDB v2 Phase 2B (B-3, B-6): business RLS, teacher scope, mark_attendance v2

-- =============================================================================
-- 1. Role helpers (verify against organization_members, not JWT alone)
-- =============================================================================

CREATE OR REPLACE FUNCTION current_member_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT member_role(auth.uid(), auth_organization_id());
$$;

CREATE OR REPLACE FUNCTION auth_teacher_scope()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    member_scope(auth.uid(), auth_organization_id()),
    '{"discipline_ids":[],"location_ids":[],"all_disciplines":false,"all_locations":false,"can_view_all_clients":false}'::jsonb
  );
$$;

CREATE OR REPLACE FUNCTION can_read_all_business()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT current_member_role() IN ('owner', 'director', 'admin', 'accountant');
$$;

CREATE OR REPLACE FUNCTION can_write_all_business()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT current_member_role() IN ('owner', 'director', 'admin');
$$;

CREATE OR REPLACE FUNCTION can_export_data()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT current_member_role() IN ('owner', 'director', 'admin', 'accountant')
    OR (
      current_member_role() = 'teacher'
      AND (
        COALESCE((auth_teacher_scope() ->> 'all_disciplines')::boolean, false)
        OR jsonb_array_length(COALESCE(auth_teacher_scope() -> 'discipline_ids', '[]'::jsonb)) > 0
      )
    );
$$;

-- =============================================================================
-- 2. Teacher scope helpers (deny-by-default)
-- =============================================================================

CREATE OR REPLACE FUNCTION teacher_has_discipline_access(p_discipline_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_scope jsonb := auth_teacher_scope();
BEGIN
  IF p_discipline_id IS NULL THEN
    RETURN false;
  END IF;

  IF COALESCE((v_scope ->> 'all_disciplines')::boolean, false) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(COALESCE(v_scope -> 'discipline_ids', '[]'::jsonb)) AS elem
    WHERE elem::uuid = p_discipline_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION teacher_has_location_access(p_location_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_scope jsonb := auth_teacher_scope();
BEGIN
  IF p_location_id IS NULL THEN
    RETURN false;
  END IF;

  IF COALESCE((v_scope ->> 'all_locations')::boolean, false) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(COALESCE(v_scope -> 'location_ids', '[]'::jsonb)) AS elem
    WHERE elem::uuid = p_location_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION teacher_can_access_subscription(p_subscription_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_discipline_id uuid;
BEGIN
  SELECT s.discipline_id
  INTO v_discipline_id
  FROM subscriptions s
  WHERE s.id = p_subscription_id
    AND s.organization_id = auth_organization_id();

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  RETURN teacher_has_discipline_access(v_discipline_id);
END;
$$;

CREATE OR REPLACE FUNCTION teacher_can_access_lesson(p_lesson_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_lesson RECORD;
BEGIN
  SELECT pl.discipline_id, pl.location_id, pl.teacher_member_id
  INTO v_lesson
  FROM personal_lessons pl
  WHERE pl.id = p_lesson_id
    AND pl.organization_id = auth_organization_id();

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_lesson.teacher_member_id = auth_member_id() THEN
    RETURN true;
  END IF;

  IF NOT teacher_has_discipline_access(v_lesson.discipline_id) THEN
    RETURN false;
  END IF;

  IF v_lesson.location_id IS NOT NULL
    AND NOT teacher_has_location_access(v_lesson.location_id) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION teacher_can_access_client(p_client_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_scope jsonb := auth_teacher_scope();
BEGIN
  IF COALESCE((v_scope ->> 'can_view_all_clients')::boolean, false) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM subscriptions s
    WHERE s.organization_id = auth_organization_id()
      AND (
        s.client_id1 = p_client_id
        OR s.client_id2 = p_client_id
        OR s.client_id3 = p_client_id
      )
      AND teacher_can_access_subscription(s.id)
  ) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM personal_lessons pl
    WHERE pl.organization_id = auth_organization_id()
      AND (
        pl.client_id1 = p_client_id
        OR pl.client_id2 = p_client_id
        OR pl.client_id3 = p_client_id
      )
      AND teacher_can_access_lesson(pl.id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION teacher_can_write_clients()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public, auth
AS $$
DECLARE
  v_scope jsonb := auth_teacher_scope();
BEGIN
  IF COALESCE((v_scope ->> 'can_view_all_clients')::boolean, false) THEN
    RETURN true;
  END IF;

  RETURN COALESCE((v_scope ->> 'all_disciplines')::boolean, false)
    OR jsonb_array_length(COALESCE(v_scope -> 'discipline_ids', '[]'::jsonb)) > 0;
END;
$$;

CREATE OR REPLACE FUNCTION teacher_can_manage_disciplines_setting()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    (
      SELECT os.teachers_can_manage_disciplines
      FROM organization_settings os
      WHERE os.organization_id = auth_organization_id()
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION teacher_can_create_discipline()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public, auth
AS $$
DECLARE
  v_scope jsonb := auth_teacher_scope();
BEGIN
  IF NOT teacher_can_manage_disciplines_setting() THEN
    RETURN false;
  END IF;

  RETURN COALESCE((v_scope ->> 'all_disciplines')::boolean, false)
    OR jsonb_array_length(COALESCE(v_scope -> 'discipline_ids', '[]'::jsonb)) > 0;
END;
$$;

CREATE OR REPLACE FUNCTION teacher_can_manage_discipline_row(p_discipline_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT teacher_can_manage_disciplines_setting() THEN
    RETURN false;
  END IF;

  RETURN teacher_has_discipline_access(p_discipline_id);
END;
$$;

CREATE OR REPLACE FUNCTION teacher_can_access_schedule_slot(p_slot_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_slot RECORD;
BEGIN
  SELECT ss.discipline_id, ss.location_id, ss.teacher_member_id
  INTO v_slot
  FROM schedule_slots ss
  WHERE ss.id = p_slot_id
    AND ss.organization_id = auth_organization_id();

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_slot.teacher_member_id = auth_member_id() THEN
    RETURN true;
  END IF;

  IF v_slot.discipline_id IS NOT NULL
    AND NOT teacher_has_discipline_access(v_slot.discipline_id) THEN
    RETURN false;
  END IF;

  IF v_slot.location_id IS NOT NULL
    AND NOT teacher_has_location_access(v_slot.location_id) THEN
    RETURN false;
  END IF;

  -- Slot with null discipline/location: only assigned teacher
  IF v_slot.discipline_id IS NULL AND v_slot.location_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION teacher_can_access_class(p_class_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_discipline_id uuid;
BEGIN
  SELECT c.discipline_id
  INTO v_discipline_id
  FROM classes c
  WHERE c.id = p_class_id
    AND c.organization_id = auth_organization_id();

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  RETURN teacher_has_discipline_access(v_discipline_id);
END;
$$;

CREATE OR REPLACE FUNCTION business_row_readable()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT
    auth_organization_id() IS NOT NULL
    AND is_active_member(auth.uid(), auth_organization_id())
    AND organization_allows_reads(auth_organization_id());
$$;

CREATE OR REPLACE FUNCTION business_row_writable()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT
    auth_organization_id() IS NOT NULL
    AND is_active_member(auth.uid(), auth_organization_id())
    AND organization_allows_writes(auth_organization_id());
$$;

-- =============================================================================
-- 3. Protect subscription counters from direct client UPDATE
-- =============================================================================

CREATE OR REPLACE FUNCTION protect_subscription_counters()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.allow_subscription_counter_update', true) IS DISTINCT FROM 'true' THEN
    IF NEW.lessons_left IS DISTINCT FROM OLD.lessons_left
       OR NEW.freeze_used IS DISTINCT FROM OLD.freeze_used
       OR NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Direct update of subscription counters is not allowed; use mark_attendance RPC';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER subscriptions_protect_counters
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION protect_subscription_counters();

-- =============================================================================
-- 4. mark_attendance v2 — tenant, scope, settings-aware freeze
-- =============================================================================

CREATE OR REPLACE FUNCTION mark_attendance(
  p_date text,
  p_sub_id text,
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

  IF p_new_status NOT IN ('present', 'absent') THEN
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

  IF v_role = 'teacher' AND NOT teacher_can_access_lesson(v_lesson_uuid) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав для этого урока');
  END IF;

  IF v_lesson.subscription_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Используйте отметку через абонемент');
  END IF;

  IF v_lesson.date > v_today THEN
    RETURN jsonb_build_object('success', false, 'error', 'Отметки доступны только за прошедшие и текущий день');
  END IF;

  UPDATE personal_lessons
  SET attendance_status = p_new_status
  WHERE id = v_lesson_uuid
    AND organization_id = v_org_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION mark_attendance(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_attendance(text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION mark_personal_lesson_attendance(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_personal_lesson_attendance(text, text) TO authenticated;

-- =============================================================================
-- 5. Enable RLS on business tables
-- =============================================================================

ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE disciplines ENABLE ROW LEVEL SECURITY;
ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal_lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 6. clients
-- =============================================================================

CREATE POLICY clients_select_full_access
  ON clients FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_all_business()
  );

CREATE POLICY clients_select_teacher
  ON clients FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND current_member_role() = 'teacher'
    AND teacher_can_access_client(id)
  );

CREATE POLICY clients_insert_admin
  ON clients FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_all_business()
  );

CREATE POLICY clients_insert_teacher
  ON clients FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND current_member_role() = 'teacher'
    AND teacher_can_write_clients()
  );

CREATE POLICY clients_update_admin
  ON clients FOR UPDATE TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_all_business()
  )
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_all_business()
  );

CREATE POLICY clients_update_teacher
  ON clients FOR UPDATE TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND current_member_role() = 'teacher'
    AND teacher_can_access_client(id)
  )
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND current_member_role() = 'teacher'
    AND teacher_can_access_client(id)
  );

CREATE POLICY clients_delete_admin
  ON clients FOR DELETE TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_all_business()
  );

CREATE POLICY clients_delete_teacher
  ON clients FOR DELETE TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND current_member_role() = 'teacher'
    AND teacher_can_access_client(id)
  );

-- =============================================================================
-- 7. disciplines
-- =============================================================================

CREATE POLICY disciplines_select_full_access
  ON disciplines FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_all_business()
  );

CREATE POLICY disciplines_select_teacher
  ON disciplines FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND current_member_role() = 'teacher'
    AND teacher_has_discipline_access(id)
  );

CREATE POLICY disciplines_write_admin
  ON disciplines FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_all_business()
  );

CREATE POLICY disciplines_update_admin
  ON disciplines FOR UPDATE TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_all_business()
  )
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_all_business()
  );

CREATE POLICY disciplines_delete_admin
  ON disciplines FOR DELETE TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_all_business()
  );

CREATE POLICY disciplines_insert_teacher
  ON disciplines FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND current_member_role() = 'teacher'
    AND teacher_can_create_discipline()
  );

CREATE POLICY disciplines_update_teacher
  ON disciplines FOR UPDATE TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND current_member_role() = 'teacher'
    AND teacher_can_manage_discipline_row(id)
  )
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND current_member_role() = 'teacher'
    AND teacher_can_manage_discipline_row(id)
  );

CREATE POLICY disciplines_delete_teacher
  ON disciplines FOR DELETE TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND current_member_role() = 'teacher'
    AND teacher_can_manage_discipline_row(id)
  );

-- =============================================================================
-- 8. locations (teacher read scoped; write admin+)
-- =============================================================================

CREATE POLICY locations_select_full_access
  ON locations FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_all_business()
  );

CREATE POLICY locations_select_teacher
  ON locations FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND current_member_role() = 'teacher'
    AND teacher_has_location_access(id)
  );

CREATE POLICY locations_write_admin
  ON locations FOR ALL TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_all_business()
  )
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_all_business()
  );

-- =============================================================================
-- 9. classes + class_teachers
-- =============================================================================

CREATE POLICY classes_select_full_access
  ON classes FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_all_business()
  );

CREATE POLICY classes_select_teacher
  ON classes FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND current_member_role() = 'teacher'
    AND teacher_can_access_class(id)
  );

CREATE POLICY classes_write_admin
  ON classes FOR ALL TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_all_business()
  )
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_all_business()
  );

CREATE POLICY class_teachers_select_full_access
  ON class_teachers FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_all_business()
  );

CREATE POLICY class_teachers_select_teacher
  ON class_teachers FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND current_member_role() = 'teacher'
    AND teacher_can_access_class(class_id)
  );

CREATE POLICY class_teachers_write_admin
  ON class_teachers FOR ALL TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_all_business()
  )
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_all_business()
  );

-- =============================================================================
-- 10. prices (admin+ write; accountant/teacher read all in org)
-- =============================================================================

CREATE POLICY prices_select
  ON prices FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND current_member_role() IN ('owner', 'director', 'admin', 'accountant', 'teacher')
  );

CREATE POLICY prices_write_admin
  ON prices FOR ALL TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_all_business()
  )
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_all_business()
  );

-- =============================================================================
-- 11. subscriptions
-- =============================================================================

CREATE POLICY subscriptions_select_full_access
  ON subscriptions FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_all_business()
  );

CREATE POLICY subscriptions_select_teacher
  ON subscriptions FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND current_member_role() = 'teacher'
    AND teacher_can_access_subscription(id)
  );

CREATE POLICY subscriptions_write_admin
  ON subscriptions FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_all_business()
  );

CREATE POLICY subscriptions_update_admin
  ON subscriptions FOR UPDATE TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_all_business()
  )
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_all_business()
  );

CREATE POLICY subscriptions_delete_admin
  ON subscriptions FOR DELETE TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_all_business()
  );

CREATE POLICY subscriptions_insert_teacher
  ON subscriptions FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND current_member_role() = 'teacher'
    AND teacher_has_discipline_access(discipline_id)
  );

CREATE POLICY subscriptions_update_teacher
  ON subscriptions FOR UPDATE TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND current_member_role() = 'teacher'
    AND teacher_can_access_subscription(id)
  )
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND current_member_role() = 'teacher'
    AND teacher_can_access_subscription(id)
  );

CREATE POLICY subscriptions_delete_teacher
  ON subscriptions FOR DELETE TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND current_member_role() = 'teacher'
    AND teacher_can_access_subscription(id)
  );

-- =============================================================================
-- 12. attendance
-- =============================================================================

CREATE POLICY attendance_select_full_access
  ON attendance FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_all_business()
  );

CREATE POLICY attendance_select_teacher
  ON attendance FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND current_member_role() = 'teacher'
    AND teacher_can_access_subscription(subscription_id)
  );

CREATE POLICY attendance_write_admin
  ON attendance FOR ALL TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_all_business()
  )
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_all_business()
  );

CREATE POLICY attendance_write_teacher
  ON attendance FOR ALL TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND current_member_role() = 'teacher'
    AND teacher_can_access_subscription(subscription_id)
  )
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND current_member_role() = 'teacher'
    AND teacher_can_access_subscription(subscription_id)
  );

-- =============================================================================
-- 13. personal_lessons
-- =============================================================================

CREATE POLICY personal_lessons_select_full_access
  ON personal_lessons FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_all_business()
  );

CREATE POLICY personal_lessons_select_teacher
  ON personal_lessons FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND current_member_role() = 'teacher'
    AND teacher_can_access_lesson(id)
  );

CREATE POLICY personal_lessons_write_admin
  ON personal_lessons FOR ALL TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_all_business()
  )
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_all_business()
  );

CREATE POLICY personal_lessons_write_teacher
  ON personal_lessons FOR ALL TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND current_member_role() = 'teacher'
    AND teacher_can_access_lesson(id)
  )
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND current_member_role() = 'teacher'
    AND teacher_can_access_lesson(id)
  );

-- =============================================================================
-- 14. schedule_slots
-- =============================================================================

CREATE POLICY schedule_slots_select_full_access
  ON schedule_slots FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_all_business()
  );

CREATE POLICY schedule_slots_select_teacher
  ON schedule_slots FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND current_member_role() = 'teacher'
    AND teacher_can_access_schedule_slot(id)
  );

CREATE POLICY schedule_slots_write_admin
  ON schedule_slots FOR ALL TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_all_business()
  )
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND can_write_all_business()
  );

CREATE POLICY schedule_slots_write_teacher
  ON schedule_slots FOR ALL TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND current_member_role() = 'teacher'
    AND teacher_can_access_schedule_slot(id)
  )
  WITH CHECK (
    organization_id = auth_organization_id()
    AND business_row_writable()
    AND current_member_role() = 'teacher'
    AND teacher_can_access_schedule_slot(id)
  );

-- =============================================================================
-- 15. audit_log — owner/director read; insert via SECURITY DEFINER trigger
-- =============================================================================

CREATE POLICY audit_log_select_leadership
  ON audit_log FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND current_member_role() IN ('owner', 'director')
  );

-- =============================================================================
-- 16. Grants
-- =============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON locations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON disciplines TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON classes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON class_teachers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON clients TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON prices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON subscriptions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON attendance TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON personal_lessons TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON schedule_slots TO authenticated;
GRANT SELECT ON audit_log TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON locations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON disciplines TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON classes TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON class_teachers TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON clients TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON prices TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON subscriptions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON attendance TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON personal_lessons TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON schedule_slots TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON audit_log TO service_role;

GRANT EXECUTE ON FUNCTION current_member_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth_teacher_scope() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION can_read_all_business() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION can_write_all_business() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION can_export_data() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION teacher_has_discipline_access(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION teacher_has_location_access(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION teacher_can_access_subscription(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION teacher_can_access_lesson(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION teacher_can_access_client(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION teacher_can_write_clients() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION teacher_can_manage_disciplines_setting() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION teacher_can_create_discipline() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION teacher_can_manage_discipline_row(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION teacher_can_access_schedule_slot(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION teacher_can_access_class(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION business_row_readable() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION business_row_writable() TO authenticated, service_role;
