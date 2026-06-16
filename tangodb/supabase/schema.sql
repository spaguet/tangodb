-- TangoDB initial schema (TZ v1.5, Prompt 1)
-- Run order: tables → seed data → RLS → RPC → GRANT

-- =============================================================================
-- 1. Tables
-- =============================================================================

CREATE TABLE IF NOT EXISTS allowed_users (
  telegram_id   BIGINT PRIMARY KEY,
  display_name  TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clients (
  id          TEXT PRIMARY KEY,
  first_name  TEXT NOT NULL,
  last_name   TEXT NOT NULL,
  telegram    TEXT DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT now(),
  archived_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_clients_active_last_name
  ON clients (last_name)
  WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS disciplines (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS schedule (
  id             SERIAL PRIMARY KEY,
  day_of_week    INTEGER NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  time           TEXT NOT NULL,
  time_end       TEXT NOT NULL DEFAULT '21:00',
  discipline_id  INTEGER REFERENCES disciplines(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS schedule_no_discipline_unique
  ON schedule (day_of_week, time)
  WHERE discipline_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS schedule_with_discipline_unique
  ON schedule (day_of_week, time, discipline_id)
  WHERE discipline_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS prices (
  id          SERIAL PRIMARY KEY,
  type        TEXT NOT NULL,
  lessons     INTEGER NOT NULL,
  price       NUMERIC NOT NULL DEFAULT 0,
  label       TEXT,
  description TEXT,
  category    TEXT NOT NULL CHECK (category IN ('group', 'private')),
  UNIQUE (type, lessons)
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id               TEXT PRIMARY KEY,
  type             TEXT NOT NULL,
  client_id1       TEXT NOT NULL REFERENCES clients(id),
  client_id2       TEXT REFERENCES clients(id),
  client_id3       TEXT REFERENCES clients(id),
  lessons_total    INTEGER NOT NULL CHECK (lessons_total >= 1),
  lessons_left     INTEGER NOT NULL,
  freeze_used      INTEGER NOT NULL DEFAULT 0 CHECK (freeze_used BETWEEN 0 AND 1),
  activation_date  DATE NOT NULL,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished')),
  pair_month       TEXT DEFAULT '',
  discipline_id    INTEGER REFERENCES disciplines(id),
  price_id         INTEGER REFERENCES prices(id),
  category         TEXT NOT NULL DEFAULT 'group' CHECK (category IN ('group', 'private')),
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attendance (
  id                  SERIAL PRIMARY KEY,
  date                DATE NOT NULL,
  subscription_id     TEXT NOT NULL REFERENCES subscriptions(id),
  client_display      TEXT NOT NULL,
  attendance_status   TEXT NOT NULL CHECK (attendance_status IN ('present', 'absent', 'freeze')),
  UNIQUE (date, subscription_id)
);

CREATE TABLE IF NOT EXISTS personal_lessons (
  id                  TEXT PRIMARY KEY,
  type                TEXT NOT NULL CHECK (type IN ('solo', 'pair', 'trio')),
  client_id1          TEXT REFERENCES clients(id),
  client_id2          TEXT REFERENCES clients(id),
  client_id3          TEXT REFERENCES clients(id),
  date                DATE NOT NULL,
  time_start          TEXT NOT NULL DEFAULT '14:00',
  time_end            TEXT NOT NULL DEFAULT '15:00',
  price               NUMERIC NOT NULL DEFAULT 0,
  paid                TEXT NOT NULL DEFAULT 'no' CHECK (paid IN ('yes', 'no')),
  discipline_id       INTEGER REFERENCES disciplines(id),
  subscription_id     TEXT REFERENCES subscriptions(id),
  attendance_status   TEXT CHECK (attendance_status IS NULL OR attendance_status IN ('present', 'absent')),
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- =============================================================================
-- 2. Seed data
-- =============================================================================

INSERT INTO prices (type, lessons, price, category) VALUES
  ('solo', 4, 1200000, 'group'),
  ('solo', 8, 2100000, 'group'),
  ('pair_m1', 8, 3400000, 'group'),
  ('pair_m2', 8, 3100000, 'group'),
  ('pair_m3', 8, 2800000, 'group'),
  ('pair_hm', 4, 1800000, 'group'),
  ('personal_solo', 1, 900000, 'private'),
  ('personal_pair', 1, 1300000, 'private'),
  ('personal_trio', 1, 1600000, 'private')
ON CONFLICT (type, lessons) DO NOTHING;

-- Replace 123456789 with your numeric telegram_id (@userinfobot)
INSERT INTO allowed_users (telegram_id, display_name) VALUES
  (123456789, 'Преподаватель')
ON CONFLICT (telegram_id) DO NOTHING;

-- =============================================================================
-- 3. Row Level Security
-- =============================================================================

CREATE OR REPLACE FUNCTION auth_telegram_id() RETURNS BIGINT AS $$
  SELECT COALESCE(
    NULLIF(auth.jwt()->>'telegram_id', '')::BIGINT,
    NULLIF(auth.jwt()->'app_metadata'->>'telegram_id', '')::BIGINT,
    NULLIF(auth.jwt()->'user_metadata'->>'telegram_id', '')::BIGINT,
    (regexp_match(auth.jwt()->>'email', '^tg_(\d+)@tangodb\.auth$'))[1]::BIGINT
  );
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION public.is_allowed_teacher() RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.allowed_users
    WHERE telegram_id = auth_telegram_id() AND is_active
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.is_allowed_teacher() TO authenticated;

ALTER TABLE allowed_users ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['clients','disciplines','schedule','prices','subscriptions','attendance','personal_lessons']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format($p$
      DROP POLICY IF EXISTS "teacher_select" ON %I;
      CREATE POLICY "teacher_select" ON %I FOR SELECT
        USING (is_allowed_teacher())
    $p$, t, t);

    EXECUTE format($p$
      DROP POLICY IF EXISTS "teacher_insert" ON %I;
      CREATE POLICY "teacher_insert" ON %I FOR INSERT
        WITH CHECK (is_allowed_teacher())
    $p$, t, t);

    EXECUTE format($p$
      DROP POLICY IF EXISTS "teacher_update" ON %I;
      CREATE POLICY "teacher_update" ON %I FOR UPDATE
        USING (is_allowed_teacher())
        WITH CHECK (is_allowed_teacher())
    $p$, t, t);

    EXECUTE format($p$
      DROP POLICY IF EXISTS "teacher_delete" ON %I;
      CREATE POLICY "teacher_delete" ON %I FOR DELETE
        USING (is_allowed_teacher())
    $p$, t, t);
  END LOOP;
END $$;

-- =============================================================================
-- 4. RPC mark_attendance
-- =============================================================================

CREATE OR REPLACE FUNCTION mark_attendance(
  p_date TEXT,
  p_sub_id TEXT,
  p_new_status TEXT
) RETURNS JSONB AS $$
DECLARE
  v_sub RECORD;
  v_old_status TEXT;
  v_lesson_delta INT := 0;
  v_freeze_delta INT := 0;
  v_new_lessons_left INT;
  v_new_freeze_used INT;
  v_display TEXT := '';
  v_c1 RECORD;
  v_c2 RECORD;
  v_c3 RECORD;
  v_today DATE := CURRENT_DATE;
BEGIN
  IF p_date !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Неверный формат даты');
  END IF;

  IF p_date::DATE > v_today THEN
    RETURN jsonb_build_object('success', false, 'error', 'Отметки доступны только за прошедшие и текущий день');
  END IF;

  SELECT * INTO v_sub FROM subscriptions WHERE id = p_sub_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Абонемент не найден');
  END IF;

  IF v_sub.category = 'private' AND p_new_status = 'freeze' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Заморозка недоступна для персональных абонементов');
  END IF;

  SELECT attendance_status INTO v_old_status
  FROM attendance WHERE date = p_date::DATE AND subscription_id = p_sub_id;

  IF v_old_status IS NOT DISTINCT FROM p_new_status THEN
    RETURN jsonb_build_object('success', true);
  END IF;

  -- Revert old status
  IF v_old_status IN ('present','absent') THEN v_lesson_delta := 1; END IF;
  IF v_old_status = 'freeze' THEN v_freeze_delta := -1; END IF;

  -- Apply new status
  IF p_new_status IN ('present','absent') THEN v_lesson_delta := v_lesson_delta - 1; END IF;
  IF p_new_status = 'freeze' THEN v_freeze_delta := v_freeze_delta + 1; END IF;

  -- present ↔ absent — lesson delta = 0
  IF v_old_status IN ('present','absent') AND p_new_status IN ('present','absent') THEN
    v_lesson_delta := 0;
  END IF;

  IF p_new_status = 'freeze' THEN
    IF v_sub.lessons_total != 8 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Заморозка только для абонементов на 8 уроков');
    END IF;
    IF v_sub.freeze_used + v_freeze_delta > 1 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Заморозка уже использована');
    END IF;
  END IF;

  v_new_lessons_left := v_sub.lessons_left + v_lesson_delta;
  IF v_new_lessons_left < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно уроков');
  END IF;
  v_new_freeze_used := v_sub.freeze_used + v_freeze_delta;

  -- Build client_display (as in GAS markAttendance)
  SELECT last_name, first_name INTO v_c1 FROM clients WHERE id = v_sub.client_id1;
  IF FOUND THEN
    v_display := v_c1.last_name || ' ' || v_c1.first_name;
  ELSE
    v_display := v_sub.client_id1;
  END IF;
  IF v_sub.client_id2 IS NOT NULL AND v_sub.client_id2 <> '' THEN
    SELECT last_name, first_name INTO v_c2 FROM clients WHERE id = v_sub.client_id2;
    IF FOUND THEN
      v_display := v_display || ' & ' || v_c2.last_name || ' ' || v_c2.first_name;
    END IF;
  END IF;
  IF v_sub.client_id3 IS NOT NULL AND v_sub.client_id3 <> '' THEN
    SELECT last_name, first_name INTO v_c3 FROM clients WHERE id = v_sub.client_id3;
    IF FOUND THEN
      v_display := v_display || ' & ' || v_c3.last_name || ' ' || v_c3.first_name;
    END IF;
  END IF;

  INSERT INTO attendance (date, subscription_id, client_display, attendance_status)
  VALUES (p_date::DATE, p_sub_id, v_display, p_new_status)
  ON CONFLICT (date, subscription_id)
  DO UPDATE SET attendance_status = p_new_status, client_display = v_display;

  UPDATE subscriptions SET
    lessons_left = v_new_lessons_left,
    freeze_used  = v_new_freeze_used,
    status = CASE WHEN v_new_lessons_left = 0 THEN 'finished' ELSE status END
  WHERE id = p_sub_id;

  RETURN jsonb_build_object('success', true, 'newLessonsLeft', v_new_lessons_left);
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION mark_attendance(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_attendance(TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION mark_personal_lesson_attendance(
  p_lesson_id TEXT,
  p_new_status TEXT
) RETURNS JSONB AS $$
DECLARE
  v_lesson RECORD;
  v_today DATE := CURRENT_DATE;
BEGIN
  IF p_lesson_id IS NULL OR trim(p_lesson_id) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не указан идентификатор урока');
  END IF;

  IF p_new_status NOT IN ('present', 'absent') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недопустимый статус');
  END IF;

  SELECT * INTO v_lesson FROM personal_lessons WHERE id = p_lesson_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Урок не найден');
  END IF;

  IF v_lesson.subscription_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Используйте отметку через абонемент');
  END IF;

  IF v_lesson.date > v_today THEN
    RETURN jsonb_build_object('success', false, 'error', 'Отметки доступны только за прошедшие и текущий день');
  END IF;

  UPDATE personal_lessons SET attendance_status = p_new_status WHERE id = p_lesson_id;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION mark_personal_lesson_attendance(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_personal_lesson_attendance(TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION validate_personal_lesson_subscription()
RETURNS TRIGGER AS $$
DECLARE
  v_sub RECORD;
BEGIN
  IF NEW.subscription_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_sub FROM subscriptions WHERE id = NEW.subscription_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Абонемент не найден';
  END IF;

  IF v_sub.category <> 'private' THEN
    RAISE EXCEPTION 'К персональному уроку можно привязать только персональный пакет';
  END IF;

  IF v_sub.status <> 'active' OR v_sub.lessons_left <= 0 THEN
    RAISE EXCEPTION 'Пакет неактивен или исчерпан';
  END IF;

  IF v_sub.type = 'solo' THEN
    IF NEW.client_id1 IS DISTINCT FROM v_sub.client_id1
      OR COALESCE(NEW.client_id2, '') <> ''
      OR COALESCE(NEW.client_id3, '') <> '' THEN
      RAISE EXCEPTION 'Клиент урока не совпадает с владельцем пакета';
    END IF;
  ELSIF v_sub.type = 'pair' THEN
    IF NEW.client_id1 IS DISTINCT FROM v_sub.client_id1
      OR NEW.client_id2 IS DISTINCT FROM v_sub.client_id2
      OR COALESCE(NEW.client_id3, '') <> '' THEN
      RAISE EXCEPTION 'Клиенты урока не совпадают с владельцами пакета';
    END IF;
  ELSIF v_sub.type = 'trio' THEN
    IF NEW.client_id1 IS DISTINCT FROM v_sub.client_id1
      OR NEW.client_id2 IS DISTINCT FROM v_sub.client_id2
      OR NEW.client_id3 IS DISTINCT FROM v_sub.client_id3 THEN
      RAISE EXCEPTION 'Клиенты урока не совпадают с владельцами пакета';
    END IF;
  ELSE
    IF NEW.client_id1 IS DISTINCT FROM v_sub.client_id1
      OR COALESCE(NEW.client_id2, '') IS DISTINCT FROM COALESCE(v_sub.client_id2, '')
      OR COALESCE(NEW.client_id3, '') IS DISTINCT FROM COALESCE(v_sub.client_id3, '') THEN
      RAISE EXCEPTION 'Клиенты урока не совпадают с владельцами пакета';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS personal_lesson_subscription_guard ON personal_lessons;
CREATE TRIGGER personal_lesson_subscription_guard
  BEFORE INSERT OR UPDATE OF subscription_id, client_id1, client_id2, client_id3
  ON personal_lessons
  FOR EACH ROW
  EXECUTE FUNCTION validate_personal_lesson_subscription();

-- =============================================================================
-- 6. Audit log
-- =============================================================================

CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  table_name  TEXT NOT NULL,
  operation   TEXT NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  row_id      TEXT NOT NULL,
  old_data    JSONB,
  new_data    JSONB,
  changed_by  BIGINT,
  changed_at  TIMESTAMPTZ DEFAULT now()
);

CREATE OR REPLACE FUNCTION audit_trigger_fn() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_log (table_name, operation, row_id, old_data, new_data, changed_by)
  VALUES (
    TG_TABLE_NAME,
    TG_OP,
    CASE WHEN TG_OP = 'DELETE' THEN OLD.id::TEXT ELSE NEW.id::TEXT END,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
    auth_telegram_id()
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS audit_clients ON clients;
CREATE TRIGGER audit_clients
  AFTER INSERT OR UPDATE OR DELETE ON clients
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS audit_subscriptions ON subscriptions;
CREATE TRIGGER audit_subscriptions
  AFTER INSERT OR UPDATE OR DELETE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS audit_personal_lessons ON personal_lessons;
CREATE TRIGGER audit_personal_lessons
  AFTER INSERT OR UPDATE OR DELETE ON personal_lessons
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS audit_attendance ON attendance;
CREATE TRIGGER audit_attendance
  AFTER INSERT OR UPDATE OR DELETE ON attendance
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "teacher_select" ON audit_log;
CREATE POLICY "teacher_select" ON audit_log
  FOR SELECT USING (is_allowed_teacher());
