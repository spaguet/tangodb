-- Disciplines (dance styles / lesson types) linked to group and personal lessons

CREATE TABLE IF NOT EXISTS disciplines (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT now()
);

INSERT INTO disciplines (name, description) VALUES
  ('Танго', 'Аргентинское танго')
ON CONFLICT (name) DO NOTHING;

ALTER TABLE schedule
  ADD COLUMN IF NOT EXISTS discipline_id INTEGER REFERENCES disciplines(id);

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS discipline_id INTEGER REFERENCES disciplines(id);

ALTER TABLE personal_lessons
  ADD COLUMN IF NOT EXISTS discipline_id INTEGER REFERENCES disciplines(id);

-- Backfill existing rows with default discipline
UPDATE schedule
SET discipline_id = (SELECT id FROM disciplines WHERE name = 'Танго' LIMIT 1)
WHERE discipline_id IS NULL;

UPDATE subscriptions
SET discipline_id = (SELECT id FROM disciplines WHERE name = 'Танго' LIMIT 1)
WHERE discipline_id IS NULL;

UPDATE personal_lessons
SET discipline_id = (SELECT id FROM disciplines WHERE name = 'Танго' LIMIT 1)
WHERE discipline_id IS NULL;

ALTER TABLE schedule DROP CONSTRAINT IF EXISTS schedule_day_of_week_time_key;
CREATE UNIQUE INDEX IF NOT EXISTS schedule_day_time_discipline_unique
  ON schedule (day_of_week, time, discipline_id);

ALTER TABLE disciplines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "teacher_select" ON disciplines;
CREATE POLICY "teacher_select" ON disciplines FOR SELECT
  USING (auth_telegram_id() IN (SELECT telegram_id FROM allowed_users WHERE is_active));

DROP POLICY IF EXISTS "teacher_insert" ON disciplines;
CREATE POLICY "teacher_insert" ON disciplines FOR INSERT
  WITH CHECK (auth_telegram_id() IN (SELECT telegram_id FROM allowed_users WHERE is_active));

DROP POLICY IF EXISTS "teacher_update" ON disciplines;
CREATE POLICY "teacher_update" ON disciplines FOR UPDATE
  USING (auth_telegram_id() IN (SELECT telegram_id FROM allowed_users WHERE is_active))
  WITH CHECK (auth_telegram_id() IN (SELECT telegram_id FROM allowed_users WHERE is_active));

DROP POLICY IF EXISTS "teacher_delete" ON disciplines;
CREATE POLICY "teacher_delete" ON disciplines FOR DELETE
  USING (auth_telegram_id() IN (SELECT telegram_id FROM allowed_users WHERE is_active));
