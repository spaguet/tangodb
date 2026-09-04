-- FA3 / 2.9.37: P1-15 — re-check mutable create gates after miniapp locks (debt/ban/status/add-on).

BEGIN;

-- ---------------------------------------------------------------------------
-- renter_create_booking — gates after lock
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION renter_create_booking(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_ctx record;
  v_org uuid;
  v_renter uuid;
  v_member uuid;
  v_loc uuid;
  v_date date;
  v_start text;
  v_end text;
  v_key text;
  v_win record;
  v_existing rentals%ROWTYPE;
  v_counts record;
  v_id uuid;
  v_extra jsonb;
BEGIN
  SELECT * INTO v_ctx FROM _renter_actor_ctx();
  v_org := v_ctx.org_id;
  v_member := v_ctx.member_id;

  IF v_ctx.is_renter THEN
    v_renter := v_ctx.jwt_renter_id;
  ELSE
    v_renter := NULLIF(p_payload ->> 'renter_id', '')::uuid;
    IF v_renter IS NULL THEN
      PERFORM _renter_raise('renter.booking.fieldsInvalid');
    END IF;
    PERFORM _renter_staff_create_renter_ok(v_org, v_renter);
  END IF;

  PERFORM _renter_create_gates(v_org, v_renter, true);

  v_loc := NULLIF(p_payload ->> 'location_id', '')::uuid;
  v_date := (p_payload ->> 'rental_date')::date;
  v_start := normalize_hhmm(p_payload ->> 'time_start');
  v_end := normalize_hhmm(p_payload ->> 'time_end');
  v_key := NULLIF(trim(p_payload ->> 'idempotency_key'), '');

  IF v_loc IS NULL OR v_date IS NULL OR v_start IS NULL OR v_end IS NULL THEN
    PERFORM _renter_raise('renter.booking.fieldsInvalid');
  END IF;

  PERFORM _renter_validate_slot_grid(v_start, v_end);
  SELECT * INTO v_win FROM _renter_occupancy_window(v_org);
  IF v_date < v_win.window_start OR v_date > v_win.window_end THEN
    PERFORM _renter_raise('renter.booking.outsideWindow');
  END IF;

  v_extra := jsonb_build_array(
    jsonb_build_object('location_id', v_loc, 'date', v_date)
  );
  PERFORM _renter_acquire_miniapp_locks(v_org, v_renter, v_extra);
  PERFORM _renter_create_gates(v_org, v_renter, true);

  IF v_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM rentals r
    WHERE r.organization_id = v_org AND r.idempotency_key = v_key;

    IF FOUND THEN
      IF v_existing.location_id IS DISTINCT FROM v_loc
         OR v_existing.rental_date IS DISTINCT FROM v_date
         OR v_existing.time_start IS DISTINCT FROM v_start
         OR v_existing.time_end IS DISTINCT FROM v_end
         OR v_existing.renter_id IS DISTINCT FROM v_renter THEN
        PERFORM _renter_raise('renter.booking.idempotencyMismatch');
      END IF;
      RETURN jsonb_build_object(
        'success', true,
        'already_applied', true,
        'rental', _renter_public_rental_json(v_existing.id)
      );
    END IF;
  END IF;

  SELECT * INTO v_existing
  FROM rentals r
  WHERE r.organization_id = v_org
    AND r.renter_id = v_renter
    AND r.location_id = v_loc
    AND r.rental_date = v_date
    AND r.time_start = v_start
    AND r.time_end = v_end
    AND r.channel = 'miniapp'
    AND r.lifecycle IN ('awaiting_payment', 'active', 'prepaid_charged')
  ORDER BY r.created_at
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_applied', true,
      'rental', _renter_public_rental_json(v_existing.id)
    );
  END IF;

  SELECT * INTO v_counts FROM _renter_unfinished_counts(v_org, v_renter);
  IF v_counts.awaiting_n >= 4 THEN
    PERFORM _renter_raise('renter.booking.holdLimit');
  END IF;
  IF v_counts.unfinished_n >= 32 THEN
    PERFORM _renter_raise('renter.booking.unfinishedLimit');
  END IF;

  v_id := _renter_insert_occurrence(
    v_org, v_renter, v_loc, v_date, v_start, v_end,
    'one_time', NULL, v_key, v_member
  );

  PERFORM _renter_apply_wallet(v_org, v_renter);

  RETURN jsonb_build_object(
    'success', true,
    'rental', _renter_public_rental_json(v_id)
  );
EXCEPTION
  WHEN unique_violation THEN
    IF v_key IS NOT NULL THEN
      SELECT id INTO v_id FROM rentals WHERE organization_id = v_org AND idempotency_key = v_key;
      IF v_id IS NOT NULL THEN
        RETURN jsonb_build_object(
          'success', true,
          'already_applied', true,
          'rental', _renter_public_rental_json(v_id)
        );
      END IF;
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'renter.booking.duplicate');
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
  WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.booking.fieldsInvalid');
END;
$$;

COMMENT ON FUNCTION renter_create_booking(jsonb) IS
  'R1c/FA3: one-time Mini App create; mutable gates before and after miniapp locks.';

-- ---------------------------------------------------------------------------
-- renter_create_recurring_pack — gates after lock
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION renter_create_recurring_pack(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_ctx record;
  v_org uuid;
  v_renter uuid;
  v_member uuid;
  v_loc uuid;
  v_from date;
  v_to date;
  v_start text;
  v_end text;
  v_key text;
  v_weekdays int[];
  v_win record;
  v_existing rental_series%ROWTYPE;
  v_patterns jsonb;
  v_occ record;
  v_extra jsonb := '[]'::jsonb;
  v_series_id uuid;
  v_id uuid;
  v_ids uuid[] := '{}';
  v_counts record;
  v_n integer := 0;
  v_awaiting integer;
BEGIN
  SELECT * INTO v_ctx FROM _renter_actor_ctx();
  v_org := v_ctx.org_id;
  v_member := v_ctx.member_id;

  IF v_ctx.is_renter THEN
    v_renter := v_ctx.jwt_renter_id;
  ELSE
    v_renter := NULLIF(p_payload ->> 'renter_id', '')::uuid;
    IF v_renter IS NULL THEN
      PERFORM _renter_raise('renter.booking.fieldsInvalid');
    END IF;
    PERFORM _renter_staff_create_renter_ok(v_org, v_renter);
  END IF;

  PERFORM _renter_create_gates(v_org, v_renter, true);

  v_loc := NULLIF(p_payload ->> 'location_id', '')::uuid;
  v_from := (p_payload ->> 'valid_from')::date;
  v_to := (p_payload ->> 'valid_to')::date;
  v_start := normalize_hhmm(p_payload ->> 'time_start');
  v_end := normalize_hhmm(p_payload ->> 'time_end');
  v_key := NULLIF(trim(p_payload ->> 'idempotency_key'), '');

  PERFORM _renter_validate_slot_grid(v_start, v_end);

  IF p_payload -> 'weekdays' IS NOT NULL THEN
    SELECT COALESCE(array_agg(value::int), '{}')
    INTO v_weekdays
    FROM jsonb_array_elements_text(p_payload -> 'weekdays') t(value);
  ELSE
    SELECT COALESCE(array_agg(value::int), '{}')
    INTO v_weekdays
    FROM jsonb_array_elements_text(p_payload -> 'days_of_week') t(value);
  END IF;

  IF v_loc IS NULL OR v_from IS NULL OR v_to IS NULL OR cardinality(v_weekdays) = 0 THEN
    PERFORM _renter_raise('renter.booking.fieldsInvalid');
  END IF;

  IF v_to <> v_from + 27 THEN
    PERFORM _renter_raise('renter.booking.packWindow');
  END IF;

  SELECT * INTO v_win FROM _renter_occupancy_window(v_org);
  IF v_from < v_win.window_start OR v_from > v_win.window_end THEN
    PERFORM _renter_raise('renter.booking.outsideWindow');
  END IF;

  IF NOT (EXTRACT(ISODOW FROM v_from)::integer = ANY (v_weekdays)) THEN
    PERFORM _renter_raise('renter.booking.packWindow');
  END IF;

  v_patterns := jsonb_build_array(
    jsonb_build_object(
      'days_of_week', to_jsonb(v_weekdays),
      'time_start', v_start,
      'time_end', v_end
    )
  );

  FOR v_occ IN
    SELECT occurrence_date, time_start, time_end
    FROM _generate_series_occurrence_dates(v_from, v_to, v_patterns)
  LOOP
    v_n := v_n + 1;
    v_extra := v_extra || jsonb_build_array(
      jsonb_build_object('location_id', v_loc, 'date', v_occ.occurrence_date)
    );
  END LOOP;

  IF v_n = 0 THEN
    PERFORM _renter_raise('renter.booking.packWindow');
  END IF;

  PERFORM _renter_acquire_miniapp_locks(v_org, v_renter, v_extra);
  PERFORM _renter_create_gates(v_org, v_renter, true);

  IF v_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM rental_series rs
    WHERE rs.organization_id = v_org AND rs.idempotency_key = v_key;

    IF FOUND THEN
      IF v_existing.location_id IS DISTINCT FROM v_loc
         OR v_existing.valid_from IS DISTINCT FROM v_from
         OR v_existing.valid_to IS DISTINCT FROM v_to
         OR v_existing.renter_id IS DISTINCT FROM v_renter THEN
        PERFORM _renter_raise('renter.booking.idempotencyMismatch');
      END IF;
      SELECT COALESCE(array_agg(r.id), '{}')
      INTO v_ids
      FROM rentals r
      WHERE r.rental_series_id = v_existing.id;
      RETURN jsonb_build_object(
        'success', true,
        'already_applied', true,
        'series_id', v_existing.id,
        'rental_ids', to_jsonb(v_ids)
      );
    END IF;
  END IF;

  SELECT * INTO v_counts FROM _renter_unfinished_counts(v_org, v_renter);
  IF v_counts.unfinished_n + v_n > 32 THEN
    PERFORM _renter_raise('renter.booking.unfinishedLimit');
  END IF;

  INSERT INTO rental_series (
    organization_id, renter_id, contract_id, location_id, tariff_id,
    channel, valid_from, valid_to, status, purpose, idempotency_key, created_by
  )
  VALUES (
    v_org, v_renter, NULL, v_loc, NULL,
    'miniapp', v_from, v_to, 'active',
    NULLIF(trim(p_payload ->> 'purpose'), ''),
    v_key, v_member
  )
  RETURNING id INTO v_series_id;

  INSERT INTO rental_series_patterns (organization_id, series_id, days_of_week, time_start, time_end)
  VALUES (v_org, v_series_id, v_weekdays, v_start, v_end);

  FOR v_occ IN
    SELECT occurrence_date, time_start, time_end
    FROM _generate_series_occurrence_dates(v_from, v_to, v_patterns)
  LOOP
    v_id := _renter_insert_occurrence(
      v_org,
      v_renter,
      v_loc,
      v_occ.occurrence_date,
      v_occ.time_start,
      v_occ.time_end,
      'recurring',
      v_series_id,
      CASE WHEN v_key IS NULL THEN NULL ELSE v_key || ':' || v_occ.occurrence_date::text END,
      v_member
    );
    v_ids := v_ids || v_id;
  END LOOP;

  PERFORM _renter_apply_wallet(v_org, v_renter);

  SELECT count(*)
  INTO v_awaiting
  FROM rentals r
  WHERE r.rental_series_id = v_series_id
    AND r.lifecycle = 'awaiting_payment';

  IF v_awaiting > 0 THEN
    PERFORM _renter_raise('renter.booking.packIncomplete');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'series_id', v_series_id,
    'rental_ids', to_jsonb(v_ids),
    'occurrence_count', v_n
  );
EXCEPTION
  WHEN unique_violation THEN
    IF v_key IS NOT NULL THEN
      SELECT id INTO v_series_id FROM rental_series WHERE organization_id = v_org AND idempotency_key = v_key;
      IF v_series_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', true, 'series_id', v_series_id, 'already_applied', true);
      END IF;
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'renter.booking.duplicate');
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
  WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.booking.fieldsInvalid');
END;
$$;

COMMENT ON FUNCTION renter_create_recurring_pack(jsonb) IS
  'R1c/FA3: recurring pack create; mutable gates before and after miniapp locks.';

COMMIT;
