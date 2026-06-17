-- Fix schedule uniqueness: PostgreSQL treats NULL != NULL in UNIQUE constraints,
-- so partial indexes enforce one row per (day, time) when discipline_id IS NULL
-- and one row per (day, time, discipline) when discipline_id IS NOT NULL.

ALTER TABLE schedule DROP CONSTRAINT IF EXISTS schedule_day_of_week_time_key;
ALTER TABLE schedule DROP CONSTRAINT IF EXISTS schedule_day_of_week_time_discipline_id_key;
DROP INDEX IF EXISTS schedule_day_time_discipline_unique;

CREATE UNIQUE INDEX IF NOT EXISTS schedule_no_discipline_unique
  ON schedule (day_of_week, time)
  WHERE discipline_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS schedule_with_discipline_unique
  ON schedule (day_of_week, time, discipline_id)
  WHERE discipline_id IS NOT NULL;
