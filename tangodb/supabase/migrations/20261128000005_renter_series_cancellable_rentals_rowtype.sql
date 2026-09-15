-- Fix: FOR-loop record cannot cast to rentals in cancel helper calls (schedule week load).

BEGIN;

CREATE OR REPLACE FUNCTION _renter_series_has_cancellable_pack_slots(
  p_series_id uuid,
  p_is_renter boolean
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_series rental_series%ROWTYPE;
  v_slot rentals%ROWTYPE;
BEGIN
  IF p_series_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO v_series FROM rental_series WHERE id = p_series_id;
  IF NOT FOUND OR v_series.channel IS DISTINCT FROM 'miniapp' OR v_series.status IS DISTINCT FROM 'active' THEN
    RETURN false;
  END IF;

  FOR v_slot IN
    SELECT r.*
    FROM rentals r
    WHERE r.rental_series_id = p_series_id
      AND r.channel = 'miniapp'
      AND r.lifecycle IN ('awaiting_payment', 'active', 'prepaid_charged', 'debt')
  LOOP
    IF _renter_can_cancel_occurrence_row(v_slot, p_is_renter)
       OR _renter_can_delete_hold_row(v_slot, p_is_renter) THEN
      RETURN true;
    END IF;
  END LOOP;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION _renter_cancel_future_miniapp_for_ban(p_org_id uuid, p_renter_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_slot rentals%ROWTYPE;
  v_now timestamptz := now();
  v_start timestamptz;
  v_series_ids uuid[] := '{}';
BEGIN
  FOR v_slot IN
    SELECT r.*
    FROM rentals r
    WHERE r.organization_id = p_org_id
      AND r.renter_id = p_renter_id
      AND r.channel = 'miniapp'
      AND r.lifecycle IN ('awaiting_payment', 'active', 'prepaid_charged', 'debt')
    ORDER BY r.rental_date, r.time_start, r.created_at
  LOOP
    v_start := _renter_slot_ts(p_org_id, v_slot.rental_date, v_slot.time_start);
    IF v_start <= v_now THEN
      CONTINUE;
    END IF;

    IF _renter_can_delete_hold_row(v_slot, false) THEN
      PERFORM _renter_delete_hold_slot(v_slot.id, NULL);
    ELSE
      PERFORM _renter_cancel_one_slot(v_slot.id, false, NULL);
    END IF;

    IF v_slot.rental_series_id IS NOT NULL THEN
      v_series_ids := array_append(v_series_ids, v_slot.rental_series_id);
    END IF;
  END LOOP;

  IF v_series_ids <> '{}' THEN
    PERFORM _renter_after_pack_slot_terminal(sid, 'ban')
    FROM (SELECT DISTINCT unnest(v_series_ids) AS sid) s;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
