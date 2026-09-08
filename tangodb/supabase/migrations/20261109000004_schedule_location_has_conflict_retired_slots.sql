-- Align schedule_location_has_conflict with preview_rental_conflicts / _renter_location_slot_busy:
-- retired group slots (valid_to <= valid_from) and cancelled occurrences must not block writes.

BEGIN;

CREATE OR REPLACE FUNCTION schedule_location_has_conflict(
  p_org_id uuid,
  p_date date,
  p_time_start text,
  p_time_end text,
  p_location_id uuid,
  p_exclude_slot_id uuid DEFAULT NULL,
  p_exclude_event_id uuid DEFAULT NULL,
  p_exclude_rental_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_time_start text;
  v_time_end text;
  v_dow integer;
BEGIN
  v_time_start := normalize_hhmm(p_time_start);
  v_time_end := normalize_hhmm(p_time_end);

  IF _hhmm_to_minutes(v_time_end) <= _hhmm_to_minutes(v_time_start) THEN
    RETURN true;
  END IF;

  v_dow := EXTRACT(ISODOW FROM p_date)::integer;

  IF EXISTS (
    SELECT 1
    FROM personal_lessons p
    WHERE p.organization_id = p_org_id
      AND p.date = p_date
      AND p.cancelled_at IS NULL
      AND p.location_id IS NOT DISTINCT FROM p_location_id
      AND schedule_time_ranges_overlap(p.time_start, p.time_end, v_time_start, v_time_end)
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM schedule_slots s
    WHERE s.organization_id = p_org_id
      AND s.day_of_week = v_dow
      AND s.location_id IS NOT DISTINCT FROM p_location_id
      AND s.id IS DISTINCT FROM p_exclude_slot_id
      AND _schedule_slot_active_on_date(s.valid_from, s.valid_to, p_date)
      AND schedule_time_ranges_overlap(s.time, s.time_end, v_time_start, v_time_end)
      AND NOT EXISTS (
        SELECT 1
        FROM schedule_occurrence_cancellations soc
        WHERE soc.organization_id = p_org_id
          AND soc.slot_id = s.id
          AND soc.occurrence_date = p_date
      )
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM calendar_event_sessions ces
    JOIN calendar_events ce ON ce.id = ces.event_id AND ce.organization_id = ces.organization_id
    WHERE ces.organization_id = p_org_id
      AND ces.session_date = p_date
      AND ces.location_id IS NOT DISTINCT FROM p_location_id
      AND ce.id IS DISTINCT FROM p_exclude_event_id
      AND schedule_time_ranges_overlap(ces.time_start, ces.time_end, v_time_start, v_time_end)
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM rentals r
    WHERE r.organization_id = p_org_id
      AND r.rental_date = p_date
      AND r.location_id IS NOT DISTINCT FROM p_location_id
      AND r.booking_status = 'confirmed'
      AND r.id IS DISTINCT FROM p_exclude_rental_id
      AND schedule_time_ranges_overlap(r.time_start, r.time_end, v_time_start, v_time_end)
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

COMMIT;
