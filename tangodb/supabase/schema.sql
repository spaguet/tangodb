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
  created_at  TIMESTAMPTZ DEFAULT now()
);

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
  discipline_id  INTEGER REFERENCES disciplines(id),
  UNIQUE (day_of_week, time, discipline_id)
);

CREATE TABLE IF NOT EXISTS prices (
  id       SERIAL PRIMARY KEY,
  type     TEXT NOT NULL,
  lessons  INTEGER NOT NULL,
  price    NUMERIC NOT NULL DEFAULT 0,
  UNIQUE (type, lessons)
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id               TEXT PRIMARY KEY,
  type             TEXT NOT NULL CHECK (type IN ('solo', 'pair', 'pair_hm')),
  client_id1       TEXT NOT NULL REFERENCES clients(id),
  client_id2       TEXT REFERENCES clients(id),
  lessons_total    INTEGER NOT NULL CHECK (lessons_total IN (4, 8)),
  lessons_left     INTEGER NOT NULL,
  freeze_used      INTEGER NOT NULL DEFAULT 0 CHECK (freeze_used BETWEEN 0 AND 1),
  activation_date  DATE NOT NULL,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished')),
  pair_month       TEXT DEFAULT '',
  discipline_id    INTEGER REFERENCES disciplines(id),
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
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('solo', 'pair', 'trio')),
  client_id1  TEXT REFERENCES clients(id),
  client_id2  TEXT REFERENCES clients(id),
  client_id3  TEXT REFERENCES clients(id),
  date        DATE NOT NULL,
  time_start  TEXT NOT NULL DEFAULT '14:00',
  time_end    TEXT NOT NULL DEFAULT '15:00',
  price       NUMERIC NOT NULL DEFAULT 0,
  paid           TEXT NOT NULL DEFAULT 'no' CHECK (paid IN ('yes', 'no')),
  discipline_id  INTEGER REFERENCES disciplines(id),
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- =============================================================================
-- 2. Seed data
-- =============================================================================

INSERT INTO prices (type, lessons, price) VALUES
  ('solo', 4, 1200000),
  ('solo', 8, 2100000),
  ('pair_m1', 8, 3400000),
  ('pair_m2', 8, 3100000),
  ('pair_m3', 8, 2800000),
  ('pair_hm', 4, 1800000),
  ('personal_solo', 1, 900000),
  ('personal_pair', 1, 1300000),
  ('personal_trio', 1, 1600000)
ON CONFLICT (type, lessons) DO NOTHING;

-- Replace 123456789 with your numeric telegram_id (@userinfobot)
INSERT INTO allowed_users (telegram_id, display_name) VALUES
  (123456789, 'Преподаватель')
ON CONFLICT (telegram_id) DO NOTHING;

-- =============================================================================
-- 3. Row Level Security
-- =============================================================================

CREATE OR REPLACE FUNCTION auth_telegram_id() RETURNS BIGINT AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'telegram_id', '')::BIGINT;
$$ LANGUAGE sql STABLE;

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
        USING (auth_telegram_id() IN (SELECT telegram_id FROM allowed_users WHERE is_active))
    $p$, t, t);

    EXECUTE format($p$
      DROP POLICY IF EXISTS "teacher_insert" ON %I;
      CREATE POLICY "teacher_insert" ON %I FOR INSERT
        WITH CHECK (auth_telegram_id() IN (SELECT telegram_id FROM allowed_users WHERE is_active))
    $p$, t, t);

    EXECUTE format($p$
      DROP POLICY IF EXISTS "teacher_update" ON %I;
      CREATE POLICY "teacher_update" ON %I FOR UPDATE
        USING (auth_telegram_id() IN (SELECT telegram_id FROM allowed_users WHERE is_active))
        WITH CHECK (auth_telegram_id() IN (SELECT telegram_id FROM allowed_users WHERE is_active))
    $p$, t, t);

    EXECUTE format($p$
      DROP POLICY IF EXISTS "teacher_delete" ON %I;
      CREATE POLICY "teacher_delete" ON %I FOR DELETE
        USING (auth_telegram_id() IN (SELECT telegram_id FROM allowed_users WHERE is_active))
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
BEGIN
  SELECT * INTO v_sub FROM subscriptions WHERE id = p_sub_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Абонемент не найден');
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
