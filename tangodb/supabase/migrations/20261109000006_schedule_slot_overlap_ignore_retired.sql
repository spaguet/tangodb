-- Retired group slots (valid_to <= valid_from) must not block new schedule_slots inserts.
-- Align prevent_schedule_slot_overlap with isRetiredScheduleSlot / rental conflict checks.

BEGIN;

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
      AND NOT (s.valid_to IS NOT NULL AND s.valid_to <= COALESCE(s.valid_from, DATE '2000-01-01'))
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

COMMIT;
