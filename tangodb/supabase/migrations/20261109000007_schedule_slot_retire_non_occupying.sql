-- Retired schedule_slots must occupy zero dates.
-- Encoding: valid_to = valid_from - 1 (tombstone). valid_from = valid_to remains a one-day class.
-- Backfill previous tombstones (valid_to = valid_from) that blocked new slots and personal lessons.

BEGIN;

CREATE OR REPLACE FUNCTION _schedule_slot_is_retired(p_valid_from date, p_valid_to date)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_valid_to IS NOT NULL
     AND p_valid_to < COALESCE(p_valid_from, DATE '2000-01-01');
$$;

COMMENT ON FUNCTION _schedule_slot_is_retired(date, date) IS
  'True for delete-from-start tombstones (valid_to < valid_from). One-day classes (valid_to = valid_from) are active.';

CREATE OR REPLACE FUNCTION _schedule_slot_active_on_date(
  p_valid_from date,
  p_valid_to date,
  p_date date
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NOT _schedule_slot_is_retired(p_valid_from, p_valid_to)
     AND COALESCE(p_valid_from, DATE '2000-01-01') <= p_date
     AND (p_valid_to IS NULL OR p_date <= p_valid_to);
$$;

COMMENT ON FUNCTION _schedule_slot_active_on_date(date, date, date) IS
  'True when a schedule_slots row occupies p_date (excludes retired tombstones valid_to < valid_from).';

CREATE OR REPLACE FUNCTION prevent_schedule_slot_overlap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF _schedule_slot_is_retired(NEW.valid_from, NEW.valid_to) THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM schedule_slots s
    WHERE s.organization_id = NEW.organization_id
      AND s.day_of_week = NEW.day_of_week
      AND s.location_id IS NOT DISTINCT FROM NEW.location_id
      AND s.id IS DISTINCT FROM NEW.id
      AND NOT _schedule_slot_is_retired(s.valid_from, s.valid_to)
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

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'schedule_slots'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%valid_to%'
      AND pg_get_constraintdef(c.oid) ILIKE '%valid_from%'
  LOOP
    EXECUTE format('ALTER TABLE schedule_slots DROP CONSTRAINT %I', r.conname);
  END LOOP;
END;
$$;

-- Existing rows with valid_to = valid_from were treated as retired in the grid; keep them retired.
UPDATE schedule_slots
SET valid_to = valid_from - 1
WHERE valid_to IS NOT NULL
  AND valid_to <= valid_from;

ALTER TABLE schedule_slots
  ADD CONSTRAINT schedule_slots_valid_to_chk
  CHECK (valid_to IS NULL OR valid_to >= valid_from - 1);

CREATE OR REPLACE FUNCTION _retire_schedule_slot_locked(p_slot_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_from date;
BEGIN
  SELECT COALESCE(valid_from, DATE '2000-01-01')
  INTO v_from
  FROM schedule_slots
  WHERE id = p_slot_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE schedule_slots
  SET valid_to = v_from - 1
  WHERE id = p_slot_id;
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
      AND p.cancelled_at IS NULL
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
      AND _schedule_slot_active_on_date(s.valid_from, s.valid_to, NEW.date)
      AND schedule_time_ranges_overlap(
        s.time, s.time_end, NEW.time_start, NEW.time_end
      )
      AND NOT EXISTS (
        SELECT 1
        FROM schedule_occurrence_cancellations c
        WHERE c.organization_id = NEW.organization_id
          AND c.slot_id = s.id
          AND c.occurrence_date = NEW.date
      )
  ) THEN
    RAISE EXCEPTION 'personal_group_overlap'
      USING ERRCODE = 'P0001',
            DETAIL = 'Personal lesson overlaps with group schedule slot';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION _is_group_slot_occurrence_date(
  p_slot schedule_slots,
  p_date date
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_valid_from date := COALESCE(p_slot.valid_from, DATE '2000-01-01');
BEGIN
  IF _schedule_slot_is_retired(p_slot.valid_from, p_slot.valid_to) THEN
    RETURN false;
  END IF;

  IF EXTRACT(ISODOW FROM p_date)::integer <> p_slot.day_of_week THEN
    RETURN false;
  END IF;

  IF p_date < v_valid_from THEN
    RETURN false;
  END IF;

  IF p_slot.valid_to IS NOT NULL AND p_date > p_slot.valid_to THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION _group_slot_occurrences_in_range(
  p_slot schedule_slots,
  p_range_start date,
  p_range_end date
)
RETURNS date[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_dates date[] := ARRAY[]::date[];
  v_current date;
  v_valid_from date := COALESCE(p_slot.valid_from, DATE '2000-01-01');
  v_valid_to date := p_slot.valid_to;
BEGIN
  IF p_range_end < p_range_start THEN
    RETURN v_dates;
  END IF;

  IF _schedule_slot_is_retired(p_slot.valid_from, p_slot.valid_to) THEN
    RETURN v_dates;
  END IF;

  IF v_valid_to IS NOT NULL AND p_range_start > v_valid_to THEN
    RETURN v_dates;
  END IF;

  IF p_range_end < v_valid_from THEN
    RETURN v_dates;
  END IF;

  v_current := p_range_start;
  WHILE EXTRACT(ISODOW FROM v_current)::integer <> p_slot.day_of_week LOOP
    v_current := v_current + 1;
    IF v_current > p_range_end THEN
      RETURN v_dates;
    END IF;
  END LOOP;

  WHILE v_current <= p_range_end LOOP
    IF _is_group_slot_occurrence_date(p_slot, v_current) THEN
      v_dates := array_append(v_dates, v_current);
    END IF;
    v_current := v_current + 7;
  END LOOP;

  RETURN v_dates;
END;
$$;

CREATE OR REPLACE FUNCTION _expand_group_slot_dates_in_range(
  p_slot schedule_slots,
  p_range_start date,
  p_range_end date
)
RETURNS date[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  RETURN _group_slot_occurrences_in_range(p_slot, p_range_start, p_range_end);
END;
$$;

COMMIT;
