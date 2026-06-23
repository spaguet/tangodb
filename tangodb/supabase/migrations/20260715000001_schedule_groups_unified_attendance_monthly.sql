-- Unify schedule groups on classes.id, per-group attendance, monthly unlimited subscriptions.

-- =============================================================================
-- 1. Canonical schedule groups (classes table)
-- =============================================================================

CREATE OR REPLACE FUNCTION ensure_schedule_group(
  p_org_id uuid,
  p_name text,
  p_discipline_id uuid,
  p_location_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text := trim(coalesce(p_name, ''));
  v_id uuid;
BEGIN
  IF p_org_id IS NULL OR p_discipline_id IS NULL THEN
    RAISE EXCEPTION 'organization_id and discipline_id are required';
  END IF;

  SELECT c.id
  INTO v_id
  FROM classes c
  WHERE c.organization_id = p_org_id
    AND c.discipline_id = p_discipline_id
    AND lower(trim(c.name)) = lower(v_name)
    AND coalesce(c.default_location_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = coalesce(p_location_id, '00000000-0000-0000-0000-000000000000'::uuid)
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO classes (
    organization_id,
    name,
    discipline_id,
    default_location_id
  )
  VALUES (
    p_org_id,
    coalesce(nullif(v_name, ''), 'Группа'),
    p_discipline_id,
    p_location_id
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION ensure_schedule_group(uuid, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ensure_schedule_group(uuid, text, uuid, uuid) TO authenticated, service_role;

INSERT INTO classes (organization_id, name, discipline_id, default_location_id)
SELECT DISTINCT
  ss.organization_id,
  coalesce(nullif(trim(ss.group_name), ''), 'Группа'),
  ss.discipline_id,
  ss.location_id
FROM schedule_slots ss
WHERE ss.valid_to IS NULL
  AND ss.discipline_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM classes c
    WHERE c.organization_id = ss.organization_id
      AND c.discipline_id = ss.discipline_id
      AND lower(trim(c.name)) = lower(coalesce(nullif(trim(ss.group_name), ''), 'Группа'))
      AND coalesce(c.default_location_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(ss.location_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

UPDATE schedule_slots ss
SET class_id = c.id
FROM classes c
WHERE ss.valid_to IS NULL
  AND ss.discipline_id IS NOT NULL
  AND ss.class_id IS NULL
  AND c.organization_id = ss.organization_id
  AND c.discipline_id = ss.discipline_id
  AND lower(trim(c.name)) = lower(coalesce(nullif(trim(ss.group_name), ''), 'Группа'))
  AND coalesce(c.default_location_id, '00000000-0000-0000-0000-000000000000'::uuid)
    = coalesce(ss.location_id, '00000000-0000-0000-0000-000000000000'::uuid);

CREATE OR REPLACE FUNCTION sync_schedule_slot_class_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.discipline_id IS NULL THEN
    RETURN NEW;
  END IF;

  NEW.class_id := ensure_schedule_group(
    NEW.organization_id,
    NEW.group_name,
    NEW.discipline_id,
    NEW.location_id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS schedule_slots_sync_class_id ON schedule_slots;

CREATE TRIGGER schedule_slots_sync_class_id
  BEFORE INSERT OR UPDATE OF group_name, discipline_id, location_id
  ON schedule_slots
  FOR EACH ROW
  EXECUTE FUNCTION sync_schedule_slot_class_id();

-- =============================================================================
-- 2. subscription_groups → schedule_group_id (classes.id)
-- =============================================================================

ALTER TABLE subscription_groups
  ADD COLUMN IF NOT EXISTS schedule_group_id UUID;

UPDATE subscription_groups sg
SET schedule_group_id = c.id
FROM classes c
WHERE sg.schedule_group_id IS NULL
  AND c.organization_id = sg.organization_id
  AND c.discipline_id = sg.discipline_id
  AND lower(trim(c.name)) = lower(coalesce(nullif(trim(sg.group_name), ''), 'Группа'))
  AND coalesce(c.default_location_id, '00000000-0000-0000-0000-000000000000'::uuid)
    = coalesce(sg.location_id, '00000000-0000-0000-0000-000000000000'::uuid);

DELETE FROM subscription_groups WHERE schedule_group_id IS NULL;

ALTER TABLE subscription_groups
  ALTER COLUMN schedule_group_id SET NOT NULL;

ALTER TABLE subscription_groups
  ADD CONSTRAINT subscription_groups_schedule_group_fkey
  FOREIGN KEY (organization_id, schedule_group_id)
  REFERENCES classes (organization_id, id)
  ON DELETE CASCADE;

DROP INDEX IF EXISTS subscription_groups_link_unique;

CREATE UNIQUE INDEX subscription_groups_link_unique
  ON subscription_groups (organization_id, subscription_id, schedule_group_id);

ALTER TABLE subscription_groups
  DROP COLUMN IF EXISTS group_name,
  DROP COLUMN IF EXISTS discipline_id,
  DROP COLUMN IF EXISTS location_id;

-- =============================================================================
-- 3. Attendance per schedule group
-- =============================================================================

ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS schedule_group_id UUID;

ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_organization_id_date_subscription_id_key;
ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_org_date_sub_key;

DELETE FROM attendance;

ALTER TABLE attendance
  ALTER COLUMN schedule_group_id SET NOT NULL;

ALTER TABLE attendance
  ADD CONSTRAINT attendance_schedule_group_fkey
  FOREIGN KEY (organization_id, schedule_group_id)
  REFERENCES classes (organization_id, id)
  ON DELETE CASCADE;

CREATE UNIQUE INDEX attendance_org_date_sub_group_unique
  ON attendance (organization_id, date, subscription_id, schedule_group_id);

-- =============================================================================
-- 4. Monthly unlimited billing model
-- =============================================================================

ALTER TABLE prices
  ADD COLUMN IF NOT EXISTS billing_model TEXT NOT NULL DEFAULT 'lesson_count';

ALTER TABLE prices DROP CONSTRAINT IF EXISTS prices_billing_model_check;
ALTER TABLE prices
  ADD CONSTRAINT prices_billing_model_check
  CHECK (billing_model IN ('lesson_count', 'monthly_unlimited'));

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS billing_model TEXT NOT NULL DEFAULT 'lesson_count';

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS expires_at DATE;

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_billing_model_check;
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_billing_model_check
  CHECK (billing_model IN ('lesson_count', 'monthly_unlimited'));

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_lessons_total_check;
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_lessons_total_check
  CHECK (
    (billing_model = 'monthly_unlimited' AND lessons_total = 0 AND lessons_left = 0)
    OR (billing_model = 'lesson_count' AND lessons_total >= 1)
  );

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_check;
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_billing_expiry_check
  CHECK (
    (billing_model = 'monthly_unlimited' AND expires_at IS NOT NULL AND type = 'solo')
    OR (billing_model = 'lesson_count')
  );

ALTER TABLE prices DROP CONSTRAINT IF EXISTS prices_category_check;
ALTER TABLE prices
  ADD CONSTRAINT prices_category_check
  CHECK (
    (
      category = 'group'
      AND (
        billing_model = 'monthly_unlimited'
        OR type IN ('solo', 'pair_m1', 'pair_m2', 'pair_m3', 'pair_hm')
        OR type ~ '^tariff_[a-f0-9]{12}$'
      )
    )
    OR (
      category = 'private'
      AND (
        type IN ('personal_solo', 'personal_pair', 'personal_trio')
        OR type ~ '^tariff_[a-f0-9]{12}$'
      )
    )
  );

CREATE OR REPLACE FUNCTION expire_monthly_subscriptions(p_org_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE subscriptions s
  SET status = 'finished'
  WHERE s.billing_model = 'monthly_unlimited'
    AND s.status = 'active'
    AND s.expires_at < current_date
    AND (p_org_id IS NULL OR s.organization_id = p_org_id);
END;
$$;

REVOKE ALL ON FUNCTION expire_monthly_subscriptions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION expire_monthly_subscriptions(uuid) TO authenticated, service_role;

-- =============================================================================
-- 5. mark_attendance v3 — per-group + monthly unlimited
-- =============================================================================

DROP FUNCTION IF EXISTS mark_attendance(text, text, text, uuid);

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

  IF v_role = 'teacher' AND NOT teacher_can_access_subscription(v_sub_uuid) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав для этого абонемента');
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

REVOKE ALL ON FUNCTION mark_attendance(text, text, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_attendance(text, text, text, uuid, uuid) TO authenticated;

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

GRANT SELECT ON subscriptions_teacher_v TO authenticated;
