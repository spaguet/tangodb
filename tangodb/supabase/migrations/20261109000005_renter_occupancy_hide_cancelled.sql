-- Mini App grid / list_mine must drop cancelled bookings and retired group slots.
-- Align renter_get_occupancy with _renter_location_slot_busy / _schedule_slot_active_on_date.

BEGIN;

CREATE OR REPLACE FUNCTION renter_get_occupancy(
  p_location_id uuid,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_ctx record;
  v_win record;
  v_from date;
  v_to date;
  v_busy jsonb;
  v_mine jsonb;
BEGIN
  SELECT * INTO v_ctx FROM _renter_require_renter_ctx();
  SELECT * INTO v_win FROM _renter_occupancy_window(v_ctx.org_id);

  IF NOT _renter_location_channel_ok(v_ctx.org_id, p_location_id, v_win.window_start) THEN
    PERFORM _renter_raise('renter.booking.locationUnavailable');
  END IF;

  v_from := COALESCE(p_from, v_win.window_start);
  v_to := COALESCE(p_to, v_win.window_end);
  IF v_from < v_win.window_start THEN
    v_from := v_win.window_start;
  END IF;
  IF v_to > v_win.window_end THEN
    v_to := v_win.window_end;
  END IF;
  IF v_from > v_to THEN
    PERFORM _renter_raise('renter.booking.outsideWindow');
  END IF;

  SELECT COALESCE(jsonb_agg(item ORDER BY d, ts, te), '[]'::jsonb)
  INTO v_busy
  FROM (
    SELECT DISTINCT
      p.date AS d,
      p.time_start AS ts,
      p.time_end AS te,
      jsonb_build_object('date', p.date, 'time_start', p.time_start, 'time_end', p.time_end) AS item
    FROM personal_lessons p
    WHERE p.organization_id = v_ctx.org_id
      AND p.location_id = p_location_id
      AND p.cancelled_at IS NULL
      AND p.date BETWEEN v_from AND v_to
    UNION
    SELECT
      gs::date,
      s.time,
      s.time_end,
      jsonb_build_object('date', gs::date, 'time_start', s.time, 'time_end', s.time_end)
    FROM schedule_slots s
    CROSS JOIN generate_series(v_from, v_to, interval '1 day') gs
    WHERE s.organization_id = v_ctx.org_id
      AND s.location_id = p_location_id
      AND s.day_of_week = EXTRACT(ISODOW FROM gs)::integer
      AND _schedule_slot_active_on_date(s.valid_from, s.valid_to, gs::date)
      AND NOT EXISTS (
        SELECT 1 FROM schedule_occurrence_cancellations soc
        WHERE soc.organization_id = v_ctx.org_id
          AND soc.slot_id = s.id
          AND soc.occurrence_date = gs::date
      )
    UNION
    SELECT
      ces.session_date,
      ces.time_start,
      ces.time_end,
      jsonb_build_object('date', ces.session_date, 'time_start', ces.time_start, 'time_end', ces.time_end)
    FROM calendar_event_sessions ces
    WHERE ces.organization_id = v_ctx.org_id
      AND ces.location_id = p_location_id
      AND ces.session_date BETWEEN v_from AND v_to
    UNION
    SELECT
      r.rental_date,
      r.time_start,
      r.time_end,
      jsonb_build_object('date', r.rental_date, 'time_start', r.time_start, 'time_end', r.time_end)
    FROM rentals r
    WHERE r.organization_id = v_ctx.org_id
      AND r.location_id = p_location_id
      AND r.booking_status = 'confirmed'
      AND r.rental_date BETWEEN v_from AND v_to
  ) z(d, ts, te, item);

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'date', r.rental_date,
      'time_start', r.time_start,
      'time_end', r.time_end,
      'lifecycle', r.lifecycle
    ) ORDER BY r.rental_date, r.time_start
  ), '[]'::jsonb)
  INTO v_mine
  FROM rentals r
  WHERE r.organization_id = v_ctx.org_id
    AND r.renter_id = v_ctx.renter_id
    AND r.location_id = p_location_id
    AND r.channel = 'miniapp'
    AND r.booking_status = 'confirmed'
    AND COALESCE(r.lifecycle, '') NOT IN ('cancelled', 'auto_deleted', 'hold_deleted')
    AND r.rental_date BETWEEN v_from AND v_to;

  RETURN jsonb_build_object(
    'success', true,
    'window', jsonb_build_object('from', v_win.window_start, 'to', v_win.window_end),
    'from', v_from,
    'to', v_to,
    'busy', v_busy,
    'mine', v_mine
  );
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION renter_list_mine(
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_ctx record;
  v_limit integer;
  v_offset integer;
  v_from date;
  v_to date;
  v_total integer;
  v_rows jsonb;
BEGIN
  SELECT * INTO v_ctx FROM _renter_require_renter_ctx();
  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 50), 100));
  v_offset := GREATEST(COALESCE(p_offset, 0), 0);
  v_from := _org_local_date(v_ctx.org_id) - 14;
  v_to := _org_local_date(v_ctx.org_id) + 90;

  SELECT count(*)
  INTO v_total
  FROM rentals r
  WHERE r.organization_id = v_ctx.org_id
    AND r.renter_id = v_ctx.renter_id
    AND r.channel = 'miniapp'
    AND r.booking_status = 'confirmed'
    AND COALESCE(r.lifecycle, '') NOT IN ('cancelled', 'auto_deleted', 'hold_deleted')
    AND r.rental_date BETWEEN v_from AND v_to;

  SELECT COALESCE(jsonb_agg(x.item ORDER BY x.rental_date, x.time_start, x.created_at), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      r.rental_date,
      r.time_start,
      r.created_at,
      _renter_public_rental_json(r.id) AS item
    FROM rentals r
    WHERE r.organization_id = v_ctx.org_id
      AND r.renter_id = v_ctx.renter_id
      AND r.channel = 'miniapp'
      AND r.booking_status = 'confirmed'
      AND COALESCE(r.lifecycle, '') NOT IN ('cancelled', 'auto_deleted', 'hold_deleted')
      AND r.rental_date BETWEEN v_from AND v_to
    ORDER BY r.rental_date, r.time_start, r.created_at
    LIMIT v_limit OFFSET v_offset
  ) x;

  RETURN jsonb_build_object(
    'success', true,
    'items', v_rows,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'horizon_from', v_from,
    'horizon_to', v_to
  );
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

COMMENT ON FUNCTION renter_get_occupancy(uuid, date, date) IS
  'Mini App occupancy: busy/mine exclude cancelled rentals, retired group slots, cancelled occurrences.';

COMMENT ON FUNCTION renter_list_mine(integer, integer) IS
  'Mini App Мои записи: live confirmed bookings only (cancelled/hold_deleted/auto_deleted omitted).';

COMMIT;
