-- Retire schedule slots with valid_to = valid_from (never valid_to < valid_from).

BEGIN;

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
  SET valid_to = v_from
  WHERE id = p_slot_id;
END;
$$;

COMMIT;
