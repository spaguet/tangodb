-- PERSONAL_LESSONS Stage 1: quad client, excused attendance, unified package RPC,
-- delete_personal_lesson / update_personal_lesson with date guards.

BEGIN;

-- =============================================================================
-- 1. Schema: client_id4, type quad, excused constraint
-- =============================================================================

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS client_id4 UUID;

ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_organization_id_client_id4_fkey;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_organization_id_client_id4_fkey
  FOREIGN KEY (organization_id, client_id4)
  REFERENCES clients (organization_id, id);

ALTER TABLE personal_lessons
  ADD COLUMN IF NOT EXISTS client_id4 UUID;

ALTER TABLE personal_lessons
  DROP CONSTRAINT IF EXISTS personal_lessons_organization_id_client_id4_fkey;

ALTER TABLE personal_lessons
  ADD CONSTRAINT personal_lessons_organization_id_client_id4_fkey
  FOREIGN KEY (organization_id, client_id4)
  REFERENCES clients (organization_id, id);

ALTER TABLE personal_lessons
  DROP CONSTRAINT IF EXISTS personal_lessons_type_check;

ALTER TABLE personal_lessons
  ADD CONSTRAINT personal_lessons_type_check
  CHECK (type IN ('solo', 'pair', 'trio', 'quad'));

ALTER TABLE personal_lessons
  DROP CONSTRAINT IF EXISTS personal_lessons_attendance_status_check;

ALTER TABLE personal_lessons
  ADD CONSTRAINT personal_lessons_attendance_status_check
  CHECK (
    attendance_status IS NULL
    OR attendance_status IN ('present', 'absent', 'excused')
  );

ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_type_check;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_type_check
  CHECK (
    (category = 'group' AND type IN ('solo', 'pair', 'pair_hm'))
    OR (category = 'private' AND type IN ('solo', 'pair', 'trio', 'quad'))
  );

ALTER TABLE prices
  DROP CONSTRAINT IF EXISTS prices_type_category_check;

ALTER TABLE prices
  ADD CONSTRAINT prices_type_category_check
  CHECK (
    (
      category = 'group'
      AND (
        type IN ('solo', 'pair_m1', 'pair_m2', 'pair_m3', 'pair_hm', 'monthly_unlimited')
        OR type ~ '^tariff_[a-f0-9]{12}$'
      )
    )
    OR (
      category = 'private'
      AND (
        type IN ('personal_solo', 'personal_pair', 'personal_trio', 'personal_quad')
        OR type ~ '^tariff_[a-f0-9]{12}$'
      )
    )
  );

-- =============================================================================
-- 2. Package guard trigger (quad + discipline + location via price)
-- =============================================================================

CREATE OR REPLACE FUNCTION validate_personal_lesson_subscription()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_sub RECORD;
  v_price_location uuid;
BEGIN
  IF NEW.subscription_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_sub
  FROM subscriptions
  WHERE id = NEW.subscription_id
    AND organization_id = NEW.organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Абонемент не найден';
  END IF;

  IF v_sub.category <> 'private' THEN
    RAISE EXCEPTION 'К персональному уроку можно привязать только персональный пакет';
  END IF;

  IF v_sub.status <> 'active' OR v_sub.lessons_left <= 0 THEN
    RAISE EXCEPTION 'Пакет неактивен или исчерпан';
  END IF;

  IF v_sub.discipline_id IS NOT NULL
    AND NEW.discipline_id IS DISTINCT FROM v_sub.discipline_id THEN
    RAISE EXCEPTION 'Дисциплина урока не совпадает с пакетом';
  END IF;

  IF v_sub.price_id IS NOT NULL THEN
    SELECT p.location_id
    INTO v_price_location
    FROM prices p
    WHERE p.id = v_sub.price_id
      AND p.organization_id = NEW.organization_id;

    IF v_price_location IS NOT NULL
      AND NEW.location_id IS DISTINCT FROM v_price_location THEN
      RAISE EXCEPTION 'Локация урока не совпадает с тарифом пакета';
    END IF;
  END IF;

  IF v_sub.type = 'solo' THEN
    IF NEW.client_id1 IS DISTINCT FROM v_sub.client_id1
      OR NEW.client_id2 IS NOT NULL
      OR NEW.client_id3 IS NOT NULL
      OR NEW.client_id4 IS NOT NULL THEN
      RAISE EXCEPTION 'Клиент урока не совпадает с владельцем пакета';
    END IF;
  ELSIF v_sub.type = 'pair' THEN
    IF NEW.client_id1 IS DISTINCT FROM v_sub.client_id1
      OR NEW.client_id2 IS DISTINCT FROM v_sub.client_id2
      OR NEW.client_id3 IS NOT NULL
      OR NEW.client_id4 IS NOT NULL THEN
      RAISE EXCEPTION 'Клиенты урока не совпадают с владельцами пакета';
    END IF;
  ELSIF v_sub.type = 'trio' THEN
    IF NEW.client_id1 IS DISTINCT FROM v_sub.client_id1
      OR NEW.client_id2 IS DISTINCT FROM v_sub.client_id2
      OR NEW.client_id3 IS DISTINCT FROM v_sub.client_id3
      OR NEW.client_id4 IS NOT NULL THEN
      RAISE EXCEPTION 'Клиенты урока не совпадают с владельцами пакета';
    END IF;
  ELSIF v_sub.type = 'quad' THEN
    IF NEW.client_id1 IS DISTINCT FROM v_sub.client_id1
      OR NEW.client_id2 IS DISTINCT FROM v_sub.client_id2
      OR NEW.client_id3 IS DISTINCT FROM v_sub.client_id3
      OR NEW.client_id4 IS DISTINCT FROM v_sub.client_id4 THEN
      RAISE EXCEPTION 'Клиенты урока не совпадают с владельцами пакета';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS personal_lesson_subscription_guard ON personal_lessons;

CREATE TRIGGER personal_lesson_subscription_guard
  BEFORE INSERT OR UPDATE OF subscription_id, client_id1, client_id2, client_id3, client_id4, discipline_id, location_id
  ON personal_lessons
  FOR EACH ROW
  EXECUTE FUNCTION validate_personal_lesson_subscription();

-- =============================================================================
-- 3. Teacher client scope — include client_id4
-- =============================================================================

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
        OR s.client_id4 = p_client_id
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
        OR pl.client_id4 = p_client_id
      )
      AND teacher_can_access_lesson(pl.id)
  );
END;
$$;

-- =============================================================================
-- 4. mark_personal_lesson_attendance — unified one-off + package + excused
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

  IF v_role = 'teacher' AND NOT teacher_can_access_lesson(v_lesson_uuid) THEN
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
-- 5. delete_personal_lesson — only date > current_date
-- =============================================================================

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

  IF v_lesson.date <= v_today THEN
    RETURN jsonb_build_object('success', false, 'error', 'Удаление доступно только для будущих уроков');
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

-- =============================================================================
-- 6. update_personal_lesson — date > current_date guard
-- =============================================================================

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

  IF v_lesson.date <= v_today THEN
    RETURN jsonb_build_object('success', false, 'error', 'Редактирование недоступно для прошедших и сегодняшних уроков');
  END IF;

  IF v_payload ? 'date' THEN
    BEGIN
      v_new_date := (v_payload ->> 'date')::date;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RETURN jsonb_build_object('success', false, 'error', 'Неверный формат даты');
    END;

    IF v_new_date <= v_today THEN
      RETURN jsonb_build_object('success', false, 'error', 'Новая дата должна быть в будущем');
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

REVOKE ALL ON FUNCTION mark_personal_lesson_attendance(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_personal_lesson_attendance(text, text) TO authenticated;

REVOKE ALL ON FUNCTION delete_personal_lesson(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_personal_lesson(text) TO authenticated;

REVOKE ALL ON FUNCTION update_personal_lesson(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_personal_lesson(text, jsonb) TO authenticated;

-- =============================================================================
-- 7. Teacher views — client_id4 (DROP required: PG cannot insert columns mid-view)
-- =============================================================================

DROP VIEW IF EXISTS personal_lessons_teacher_v;

CREATE VIEW personal_lessons_teacher_v
WITH (security_invoker = false) AS
SELECT
  pl.id,
  pl.organization_id,
  pl.type,
  pl.client_id1,
  pl.client_id2,
  pl.client_id3,
  pl.client_id4,
  pl.date,
  pl.time_start,
  pl.time_end,
  pl.discipline_id,
  pl.subscription_id,
  pl.location_id,
  pl.teacher_member_id,
  pl.attendance_status,
  pl.created_at,
  pl.paid
FROM personal_lessons pl
WHERE pl.organization_id = auth_organization_id()
  AND business_row_readable()
  AND current_member_role() = 'teacher'
  AND teacher_can_access_lesson(pl.id);

DROP VIEW IF EXISTS subscriptions_teacher_v;

CREATE VIEW subscriptions_teacher_v
WITH (security_invoker = false) AS
SELECT
  s.id,
  s.organization_id,
  s.type,
  s.client_id1,
  s.client_id2,
  s.client_id3,
  s.client_id4,
  s.lessons_total,
  s.lessons_left,
  s.freeze_used,
  s.activation_date,
  s.status,
  s.pair_month,
  s.discipline_id,
  s.class_id,
  s.category,
  s.billing_model,
  s.expires_at,
  s.created_at
FROM subscriptions s
WHERE s.organization_id = auth_organization_id()
  AND business_row_readable()
  AND current_member_role() = 'teacher'
  AND teacher_can_access_subscription(s.id);

GRANT SELECT ON personal_lessons_teacher_v TO authenticated;
GRANT SELECT ON subscriptions_teacher_v TO authenticated;

COMMIT;
