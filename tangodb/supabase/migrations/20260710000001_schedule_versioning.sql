-- Schedule slot versioning (valid_from / valid_to) + time normalization + overlap guards
-- See SCHEDULE_TZ.md §7.1, §7.1.1

BEGIN;

-- =============================================================================
-- 1. Versioning columns
-- =============================================================================

ALTER TABLE schedule_slots
  ADD COLUMN IF NOT EXISTS valid_from DATE NOT NULL DEFAULT '2000-01-01',
  ADD COLUMN IF NOT EXISTS valid_to DATE CHECK (valid_to IS NULL OR valid_to >= valid_from);

UPDATE schedule_slots
SET valid_from = '2000-01-01'
WHERE valid_to IS NULL;

-- =============================================================================
-- 2. Partial UNIQUE indexes (active versions only)
-- =============================================================================

DROP INDEX IF EXISTS schedule_slots_with_group_unique;
DROP INDEX IF EXISTS schedule_slots_legacy_no_group_unique;
DROP INDEX IF EXISTS schedule_slots_legacy_no_discipline_unique;

CREATE UNIQUE INDEX schedule_slots_with_group_unique
  ON schedule_slots (organization_id, day_of_week, time, lower(trim(group_name)))
  WHERE trim(group_name) <> '' AND valid_to IS NULL;

CREATE UNIQUE INDEX schedule_slots_legacy_no_group_unique
  ON schedule_slots (organization_id, day_of_week, time, discipline_id)
  WHERE trim(group_name) = '' AND discipline_id IS NOT NULL AND valid_to IS NULL;

CREATE UNIQUE INDEX schedule_slots_legacy_no_discipline_unique
  ON schedule_slots (organization_id, day_of_week, time)
  WHERE trim(group_name) = '' AND discipline_id IS NULL AND valid_to IS NULL;

CREATE INDEX idx_schedule_slots_active_validity
  ON schedule_slots (organization_id, valid_from, valid_to)
  WHERE valid_to IS NULL;

-- =============================================================================
-- 3. Time normalization (legacy 9:00 -> 09:00) + HH:MM CHECK
-- =============================================================================

CREATE OR REPLACE FUNCTION normalize_hhmm(t TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  parts TEXT[];
  h INT;
  m INT;
BEGIN
  IF t IS NULL OR trim(t) = '' THEN
    RAISE EXCEPTION 'Invalid time format: empty';
  END IF;
  parts := string_to_array(trim(t), ':');
  IF array_length(parts, 1) < 2 THEN
    RAISE EXCEPTION 'Invalid time format: %', t;
  END IF;
  h := parts[1]::INT;
  m := parts[2]::INT;
  IF h < 0 OR h > 23 OR m < 0 OR m > 59 THEN
    RAISE EXCEPTION 'Invalid time values: %', t;
  END IF;
  RETURN lpad(h::TEXT, 2, '0') || ':' || lpad(m::TEXT, 2, '0');
END;
$$;

UPDATE schedule_slots
SET
  time = normalize_hhmm(time),
  time_end = normalize_hhmm(time_end);

UPDATE personal_lessons
SET
  time_start = normalize_hhmm(time_start),
  time_end = normalize_hhmm(time_end);

ALTER TABLE schedule_slots
  DROP CONSTRAINT IF EXISTS schedule_slots_time_hhmm_chk;

ALTER TABLE schedule_slots
  ADD CONSTRAINT schedule_slots_time_hhmm_chk
  CHECK (
    time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND time_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  );

-- =============================================================================
-- 4. Overlap guards (race-safe writes)
-- =============================================================================

CREATE OR REPLACE FUNCTION schedule_date_ranges_overlap(
  from1 DATE,
  to1 DATE,
  from2 DATE,
  to2 DATE
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT from1 <= COALESCE(to2, DATE '9999-12-31')
     AND COALESCE(to1, DATE '9999-12-31') >= from2;
$$;

CREATE OR REPLACE FUNCTION schedule_time_ranges_overlap(
  start1 TEXT,
  end1 TEXT,
  start2 TEXT,
  end2 TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  s1 INT;
  e1 INT;
  s2 INT;
  e2 INT;
BEGIN
  s1 := split_part(normalize_hhmm(start1), ':', 1)::INT * 60
      + split_part(normalize_hhmm(start1), ':', 2)::INT;
  e1 := split_part(normalize_hhmm(end1), ':', 1)::INT * 60
      + split_part(normalize_hhmm(end1), ':', 2)::INT;
  s2 := split_part(normalize_hhmm(start2), ':', 1)::INT * 60
      + split_part(normalize_hhmm(start2), ':', 2)::INT;
  e2 := split_part(normalize_hhmm(end2), ':', 1)::INT * 60
      + split_part(normalize_hhmm(end2), ':', 2)::INT;
  RETURN s1 < e2 AND s2 < e1;
END;
$$;

CREATE OR REPLACE FUNCTION prevent_schedule_slot_overlap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM schedule_slots s
    WHERE s.organization_id = NEW.organization_id
      AND s.day_of_week = NEW.day_of_week
      AND s.location_id IS NOT DISTINCT FROM NEW.location_id
      AND s.id IS DISTINCT FROM NEW.id
      AND schedule_date_ranges_overlap(
        s.valid_from, s.valid_to, NEW.valid_from, NEW.valid_to
      )
      AND schedule_time_ranges_overlap(s.time, s.time_end, NEW.time, NEW.time_end)
  ) THEN
    RAISE EXCEPTION 'schedule_slot_overlap'
      USING ERRCODE = 'P0001',
            DETAIL = 'Overlapping group schedule slot in the same location and day';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION prevent_personal_lesson_overlap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM personal_lessons p
    WHERE p.organization_id = NEW.organization_id
      AND p.date = NEW.date
      AND p.location_id IS NOT DISTINCT FROM NEW.location_id
      AND p.id IS DISTINCT FROM NEW.id
      AND schedule_time_ranges_overlap(
        p.time_start, p.time_end, NEW.time_start, NEW.time_end
      )
  ) THEN
    RAISE EXCEPTION 'personal_lesson_overlap'
      USING ERRCODE = 'P0001',
            DETAIL = 'Overlapping personal lesson in the same location and date';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM schedule_slots s
    WHERE s.organization_id = NEW.organization_id
      AND s.day_of_week = EXTRACT(ISODOW FROM NEW.date)::INT
      AND s.location_id IS NOT DISTINCT FROM NEW.location_id
      AND s.valid_from <= NEW.date
      AND (s.valid_to IS NULL OR s.valid_to >= NEW.date)
      AND schedule_time_ranges_overlap(
        s.time, s.time_end, NEW.time_start, NEW.time_end
      )
  ) THEN
    RAISE EXCEPTION 'personal_group_overlap'
      USING ERRCODE = 'P0001',
            DETAIL = 'Personal lesson overlaps with group schedule slot';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS schedule_slots_prevent_overlap ON schedule_slots;
CREATE TRIGGER schedule_slots_prevent_overlap
  BEFORE INSERT OR UPDATE ON schedule_slots
  FOR EACH ROW EXECUTE FUNCTION prevent_schedule_slot_overlap();

DROP TRIGGER IF EXISTS personal_lessons_prevent_overlap ON personal_lessons;
CREATE TRIGGER personal_lessons_prevent_overlap
  BEFORE INSERT OR UPDATE ON personal_lessons
  FOR EACH ROW EXECUTE FUNCTION prevent_personal_lesson_overlap();

COMMIT;
