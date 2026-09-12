-- Mini App recurring pack: per-weekday start/end (day_slots).
-- Legacy payload weekdays + single time_start/time_end still works.

BEGIN;

CREATE OR REPLACE FUNCTION _renter_pack_day_slots_from_weekdays(
  p_weekdays int[],
  p_time_start text,
  p_time_end text
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'weekday', d,
        'time_start', normalize_hhmm(p_time_start),
        'time_end', normalize_hhmm(p_time_end)
      ) ORDER BY d
    ),
    '[]'::jsonb
  )
  FROM unnest(COALESCE(p_weekdays, '{}'::int[])) AS d;
$$;

CREATE OR REPLACE FUNCTION _renter_pack_day_slots_canonical(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_raw jsonb;
  v_out jsonb := '[]'::jsonb;
  v_elem jsonb;
  v_wd int;
  v_start text;
  v_end text;
  v_seen int[] := '{}';
  v_weekdays int[];
BEGIN
  v_raw := p_payload -> 'day_slots';
  IF jsonb_typeof(v_raw) = 'array' AND jsonb_array_length(v_raw) > 0 THEN
    FOR v_elem IN SELECT value FROM jsonb_array_elements(v_raw) LOOP
      BEGIN
        v_wd := COALESCE(
          NULLIF(v_elem ->> 'weekday', '')::int,
          NULLIF(v_elem ->> 'day_of_week', '')::int
        );
        IF v_wd IS NULL OR v_wd < 1 OR v_wd > 7 OR v_wd = ANY (v_seen) THEN
          RETURN '[]'::jsonb;
        END IF;
        v_start := normalize_hhmm(v_elem ->> 'time_start');
        v_end := normalize_hhmm(v_elem ->> 'time_end');
        v_seen := array_append(v_seen, v_wd);
        v_out := v_out || jsonb_build_array(
          jsonb_build_object(
            'weekday', v_wd,
            'time_start', v_start,
            'time_end', v_end
          )
        );
      EXCEPTION
        WHEN OTHERS THEN
          RETURN '[]'::jsonb;
      END;
    END LOOP;

    SELECT COALESCE(jsonb_agg(e ORDER BY (e ->> 'weekday')::int), '[]'::jsonb)
    INTO v_out
    FROM jsonb_array_elements(v_out) e;

    RETURN v_out;
  END IF;

  v_weekdays := _renter_parse_weekdays(p_payload);
  BEGIN
    RETURN _renter_pack_day_slots_from_weekdays(
      v_weekdays,
      p_payload ->> 'time_start',
      p_payload ->> 'time_end'
    );
  EXCEPTION
    WHEN OTHERS THEN
      RETURN '[]'::jsonb;
  END;
END;
$$;

COMMENT ON FUNCTION _renter_pack_day_slots_canonical(jsonb) IS
  'Canonical pack slots: day_slots[{weekday,time_start,time_end}] or legacy weekdays+times.';

CREATE OR REPLACE FUNCTION _renter_pack_payload_fingerprint_slots(
  p_location_id uuid,
  p_valid_from date,
  p_valid_to date,
  p_day_slots jsonb,
  p_renter_id uuid
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_weekdays int[];
  v_start text;
  v_end text;
  v_distinct int;
  v_canon text;
BEGIN
  IF p_day_slots IS NULL
     OR jsonb_typeof(p_day_slots) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_day_slots) = 0 THEN
    RETURN md5(
      concat_ws(
        '|',
        p_location_id::text,
        p_valid_from::text,
        p_valid_to::text,
        '',
        p_renter_id::text
      )
    );
  END IF;

  SELECT count(DISTINCT (e ->> 'time_start') || '|' || (e ->> 'time_end'))
  INTO v_distinct
  FROM jsonb_array_elements(p_day_slots) e;

  IF v_distinct = 1 THEN
    SELECT
      array_agg((e ->> 'weekday')::int ORDER BY (e ->> 'weekday')::int),
      (array_agg(e ->> 'time_start' ORDER BY (e ->> 'weekday')::int))[1],
      (array_agg(e ->> 'time_end' ORDER BY (e ->> 'weekday')::int))[1]
    INTO v_weekdays, v_start, v_end
    FROM jsonb_array_elements(p_day_slots) e;

    RETURN _renter_pack_payload_fingerprint(
      p_location_id, p_valid_from, p_valid_to, v_weekdays, v_start, v_end, p_renter_id
    );
  END IF;

  SELECT string_agg(
    (e ->> 'weekday') || ':' || (e ->> 'time_start') || '-' || (e ->> 'time_end'),
    ','
    ORDER BY (e ->> 'weekday')::int
  )
  INTO v_canon
  FROM jsonb_array_elements(p_day_slots) e;

  RETURN md5(
    concat_ws(
      '|',
      p_location_id::text,
      p_valid_from::text,
      p_valid_to::text,
      COALESCE(v_canon, ''),
      p_renter_id::text
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION _renter_pack_patterns_from_slots(p_day_slots jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'days_of_week', jsonb_build_array((s ->> 'weekday')::int),
        'time_start', s ->> 'time_start',
        'time_end', s ->> 'time_end'
      )
      ORDER BY (s ->> 'weekday')::int
    ),
    '[]'::jsonb
  )
  FROM jsonb_array_elements(COALESCE(p_day_slots, '[]'::jsonb)) s;
$$;

CREATE OR REPLACE FUNCTION _renter_pack_slots_from_series(p_series_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'weekday', d,
        'time_start', normalize_hhmm(p.time_start),
        'time_end', normalize_hhmm(p.time_end)
      )
      ORDER BY d
    ),
    '[]'::jsonb
  )
  FROM rental_series_patterns p
  CROSS JOIN LATERAL unnest(p.days_of_week) AS d
  WHERE p.series_id = p_series_id;
$$;

CREATE OR REPLACE FUNCTION _renter_pack_series_fingerprint(p_series_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    rs.payload_fingerprint,
    _renter_pack_payload_fingerprint_slots(
      rs.location_id,
      rs.valid_from,
      rs.valid_to,
      _renter_pack_slots_from_series(rs.id),
      rs.renter_id
    )
  )
  FROM rental_series rs
  WHERE rs.id = p_series_id;
$$;

CREATE OR REPLACE FUNCTION _renter_validate_pack_booking_slots(
  p_org_id uuid,
  p_renter_id uuid,
  p_location_id uuid,
  p_valid_from date,
  p_valid_to date,
  p_day_slots jsonb,
  p_include_gates boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_win record;
  v_reasons text[] := '{}';
  v_gate text[];
  v_kind text;
  v_occ jsonb := '[]'::jsonb;
  v_d date;
  v_dow integer;
  v_slot_reasons text[];
  v_quote jsonb;
  v_busy boolean;
  v_has_busy boolean := false;
  v_total_cost numeric := 0;
  v_total_prepay numeric := 0;
  v_total_remainder numeric := 0;
  v_currency text;
  v_can_create boolean;
  v_wallet jsonb;
  v_weekdays int[] := '{}';
  v_start text;
  v_end text;
  v_pair record;
  v_slot jsonb;
BEGIN
  IF p_day_slots IS NULL
     OR jsonb_typeof(p_day_slots) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_day_slots) = 0 THEN
    v_reasons := array_append(v_reasons, 'renter.booking.packWindow');
  ELSE
    SELECT COALESCE(array_agg((e ->> 'weekday')::int ORDER BY (e ->> 'weekday')::int), '{}')
    INTO v_weekdays
    FROM jsonb_array_elements(p_day_slots) e;

    FOR v_pair IN
      SELECT DISTINCT e ->> 'time_start' AS time_start, e ->> 'time_end' AS time_end
      FROM jsonb_array_elements(p_day_slots) e
    LOOP
      BEGIN
        PERFORM _renter_validate_slot_grid(v_pair.time_start, v_pair.time_end);
      EXCEPTION
        WHEN SQLSTATE 'P0001' THEN
          RETURN jsonb_build_object(
            'can_create', false,
            'reasons', jsonb_build_array(SQLERRM),
            'occurrences', '[]'::jsonb
          );
      END;
    END LOOP;
  END IF;

  IF p_valid_from IS NULL OR p_valid_to IS NULL THEN
    v_reasons := array_append(v_reasons, 'renter.booking.fieldsInvalid');
  ELSIF NOT _renter_pack_span_days_ok(p_valid_from, p_valid_to) THEN
    v_reasons := array_append(v_reasons, 'renter.booking.packWindow');
  END IF;

  IF cardinality(v_weekdays) = 0 THEN
    v_reasons := array_append(v_reasons, 'renter.booking.packWindow');
  ELSIF p_valid_from IS NOT NULL
        AND NOT (EXTRACT(ISODOW FROM p_valid_from)::integer = ANY (v_weekdays)) THEN
    v_reasons := array_append(v_reasons, 'renter.booking.packWindow');
  END IF;

  SELECT * INTO v_win FROM _renter_occupancy_window(p_org_id);
  IF p_valid_from IS NOT NULL
     AND (p_valid_from < v_win.window_start OR p_valid_from > v_win.window_end) THEN
    v_reasons := array_append(v_reasons, 'renter.booking.outsideWindow');
  END IF;

  IF NOT _renter_location_channel_ok(p_org_id, p_location_id, p_valid_from) THEN
    v_reasons := array_append(v_reasons, 'renter.booking.locationUnavailable');
  END IF;

  IF p_include_gates THEN
    v_gate := _renter_booking_gate_reasons(p_org_id, p_renter_id, true);
    v_reasons := v_reasons || v_gate;
  END IF;

  v_kind := _renter_effective_kind(p_org_id, p_renter_id, 'recurring');

  IF p_valid_from IS NOT NULL
     AND p_valid_to IS NOT NULL
     AND cardinality(v_weekdays) > 0 THEN
    FOR v_d IN SELECT gs::date FROM generate_series(p_valid_from, p_valid_to, interval '1 day') gs LOOP
      v_dow := EXTRACT(ISODOW FROM v_d)::integer;
      IF NOT (v_dow = ANY (v_weekdays)) THEN
        CONTINUE;
      END IF;

      SELECT e
      INTO v_slot
      FROM jsonb_array_elements(p_day_slots) e
      WHERE (e ->> 'weekday')::int = v_dow
      LIMIT 1;

      v_start := v_slot ->> 'time_start';
      v_end := v_slot ->> 'time_end';

      v_slot_reasons := _renter_slot_block_reasons(
        p_org_id, p_location_id, v_d, v_start, v_end,
        p_valid_from, p_valid_to, true
      );
      v_reasons := v_reasons || v_slot_reasons;

      v_busy := 'renter.booking.conflict' = ANY (v_slot_reasons);
      v_has_busy := v_has_busy OR v_busy;

      BEGIN
        v_quote := _renter_quote_slot_amounts(
          p_org_id, p_location_id, v_kind, v_d, v_start, v_end
        );
      EXCEPTION
        WHEN SQLSTATE 'P0001' THEN
          v_reasons := array_append(v_reasons, SQLERRM);
          CONTINUE;
      END;

      v_currency := v_quote ->> 'currency';
      v_total_cost := v_total_cost + COALESCE((v_quote ->> 'cost')::numeric, 0);
      v_total_prepay := v_total_prepay + COALESCE((v_quote ->> 'prepay')::numeric, 0);
      v_total_remainder := v_total_remainder + COALESCE((v_quote ->> 'remainder')::numeric, 0);

      v_occ := v_occ || jsonb_build_array(
        v_quote || jsonb_build_object(
          'date', v_d,
          'time_start', v_start,
          'time_end', v_end,
          'busy', v_busy,
          'reasons', to_jsonb(v_slot_reasons)
        )
      );
    END LOOP;
  END IF;

  IF jsonb_array_length(v_occ) = 0 AND NOT ('renter.booking.packWindow' = ANY (v_reasons)) THEN
    v_reasons := array_append(v_reasons, 'renter.booking.packWindow');
  END IF;

  SELECT COALESCE(array_agg(DISTINCT r), '{}')
  INTO v_reasons
  FROM unnest(v_reasons) r;

  v_can_create := cardinality(v_reasons) = 0 AND NOT v_has_busy;
  v_wallet := _renter_quote_wallet_summary(p_org_id, p_renter_id, v_total_prepay);

  RETURN jsonb_build_object(
    'can_create', v_can_create,
    'reasons', to_jsonb(v_reasons),
    'kind', v_kind,
    'valid_from', p_valid_from,
    'valid_to', p_valid_to,
    'occurrences', v_occ,
    'occurrence_count', jsonb_array_length(v_occ),
    'busy_count', (
      SELECT count(*)::int
      FROM jsonb_array_elements(v_occ) e
      WHERE COALESCE((e ->> 'busy')::boolean, false)
    ),
    'cost', v_total_cost,
    'prepay', v_total_prepay,
    'remainder', v_total_remainder,
    'currency', COALESCE(v_currency, _renter_org_currency(p_org_id))
  )
  || v_wallet
  || jsonb_build_object(
    'fingerprint', _renter_pack_payload_fingerprint_slots(
      p_location_id, p_valid_from, p_valid_to, p_day_slots, p_renter_id
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION _renter_validate_pack_booking(
  p_org_id uuid,
  p_renter_id uuid,
  p_location_id uuid,
  p_valid_from date,
  p_valid_to date,
  p_weekdays int[],
  p_time_start text,
  p_time_end text,
  p_include_gates boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  RETURN _renter_validate_pack_booking_slots(
    p_org_id,
    p_renter_id,
    p_location_id,
    p_valid_from,
    p_valid_to,
    _renter_pack_day_slots_from_weekdays(p_weekdays, p_time_start, p_time_end),
    p_include_gates
  );
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object(
      'can_create', false,
      'reasons', jsonb_build_array(SQLERRM),
      'occurrences', '[]'::jsonb
    );
END;
$$;

CREATE OR REPLACE FUNCTION _renter_normalize_booking_payload(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_from date;
  v_to date;
  v_one date;
  v_weekdays int[];
  v_slots jsonb;
BEGIN
  IF v ? 'valid_from' THEN
    v_from := _renter_parse_iso_date(v ->> 'valid_from');
    v := jsonb_set(v, '{valid_from}', CASE WHEN v_from IS NULL THEN 'null'::jsonb ELSE to_jsonb(v_from) END);
  END IF;
  IF v ? 'valid_to' THEN
    v_to := _renter_parse_iso_date(v ->> 'valid_to');
    v := jsonb_set(v, '{valid_to}', CASE WHEN v_to IS NULL THEN 'null'::jsonb ELSE to_jsonb(v_to) END);
  END IF;
  IF v ? 'valid_from' THEN
    v_slots := _renter_pack_day_slots_canonical(v);
    v := jsonb_set(v, '{day_slots}', v_slots);
    SELECT COALESCE(array_agg((e ->> 'weekday')::int ORDER BY (e ->> 'weekday')::int), '{}')
    INTO v_weekdays
    FROM jsonb_array_elements(v_slots) e;
    v := jsonb_set(v, '{weekdays}', to_jsonb(v_weekdays));
    IF jsonb_array_length(v_slots) > 0 THEN
      v := jsonb_set(v, '{time_start}', to_jsonb(v_slots -> 0 ->> 'time_start'));
      v := jsonb_set(v, '{time_end}', to_jsonb(v_slots -> 0 ->> 'time_end'));
    END IF;
  END IF;
  IF v ? 'rental_date' THEN
    v_one := _renter_parse_iso_date(v ->> 'rental_date');
    v := jsonb_set(v, '{rental_date}', CASE WHEN v_one IS NULL THEN 'null'::jsonb ELSE to_jsonb(v_one) END);
  END IF;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION _renter_quote_booking_inner(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_ctx record;
  v_org uuid;
  v_renter uuid;
  v_loc uuid;
  v_date date;
  v_start text;
  v_end text;
  v_from date;
  v_to date;
  v_slots jsonb;
  v_result jsonb;
BEGIN
  SELECT * INTO v_ctx FROM _renter_actor_ctx();
  v_org := v_ctx.org_id;

  IF NOT renter_miniapp_addon_is_active(v_org) THEN
    PERFORM _renter_raise('renter.addonInactive');
  END IF;

  v_loc := NULLIF(p_payload ->> 'location_id', '')::uuid;
  v_renter := COALESCE(v_ctx.jwt_renter_id, NULLIF(p_payload ->> 'renter_id', '')::uuid);

  IF p_payload ? 'valid_from' THEN
    v_from := (p_payload ->> 'valid_from')::date;
    v_to := (p_payload ->> 'valid_to')::date;
    v_slots := _renter_pack_day_slots_canonical(p_payload);
    v_result := _renter_validate_pack_booking_slots(
      v_org, v_renter, v_loc, v_from, v_to, v_slots, true
    );
    RETURN jsonb_build_object('success', true) || v_result;
  END IF;

  v_start := normalize_hhmm(p_payload ->> 'time_start');
  v_end := normalize_hhmm(p_payload ->> 'time_end');
  v_date := (p_payload ->> 'rental_date')::date;
  v_result := _renter_validate_one_time_booking(
    v_org, v_renter, v_loc, v_date, v_start, v_end, 'one_time', true
  );

  RETURN jsonb_build_object('success', true) || v_result;
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
  WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.booking.fieldsInvalid');
END;
$$;

CREATE OR REPLACE FUNCTION _renter_create_recurring_pack_inner(p_payload jsonb)
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
  v_key text;
  v_fp text;
  v_weekdays int[];
  v_slots jsonb;
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
  v_check jsonb;
  v_reasons text[];
  v_total_prepay numeric;
  v_available numeric;
  v_hold timestamptz;
  v_slot jsonb;
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

  v_loc := NULLIF(p_payload ->> 'location_id', '')::uuid;
  v_from := (p_payload ->> 'valid_from')::date;
  v_to := (p_payload ->> 'valid_to')::date;
  v_key := NULLIF(trim(p_payload ->> 'idempotency_key'), '');
  v_slots := _renter_pack_day_slots_canonical(p_payload);

  SELECT COALESCE(array_agg((e ->> 'weekday')::int ORDER BY (e ->> 'weekday')::int), '{}')
  INTO v_weekdays
  FROM jsonb_array_elements(v_slots) e;

  IF v_loc IS NULL OR v_from IS NULL OR v_to IS NULL OR cardinality(v_weekdays) = 0 THEN
    PERFORM _renter_raise('renter.booking.fieldsInvalid');
  END IF;

  v_check := _renter_validate_pack_booking_slots(
    v_org, v_renter, v_loc, v_from, v_to, v_slots, true
  );
  v_fp := v_check ->> 'fingerprint';
  v_n := COALESCE((v_check ->> 'occurrence_count')::int, 0);

  IF v_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM rental_series rs
    WHERE rs.organization_id = v_org AND rs.idempotency_key = v_key;

    IF FOUND THEN
      IF _renter_pack_series_fingerprint(v_existing.id) IS DISTINCT FROM v_fp THEN
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
        'rental_ids', to_jsonb(v_ids),
        'series_status', v_existing.status,
        'hold_expires_at', v_existing.hold_expires_at
      );
    END IF;
  END IF;

  SELECT COALESCE(array_agg(value), '{}')
  INTO v_reasons
  FROM jsonb_array_elements_text(v_check -> 'reasons') t(value);
  PERFORM _renter_raise_first_reason(v_reasons);

  v_patterns := _renter_pack_patterns_from_slots(v_slots);

  FOR v_occ IN
    SELECT occurrence_date, time_start, time_end
    FROM _generate_series_occurrence_dates(v_from, v_to, v_patterns)
  LOOP
    v_extra := v_extra || jsonb_build_array(
      jsonb_build_object('location_id', v_loc, 'date', v_occ.occurrence_date)
    );
  END LOOP;

  PERFORM _renter_acquire_miniapp_locks(v_org, v_renter, v_extra);
  PERFORM _renter_create_gates(v_org, v_renter, true);

  IF v_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM rental_series rs
    WHERE rs.organization_id = v_org AND rs.idempotency_key = v_key;

    IF FOUND THEN
      IF _renter_pack_series_fingerprint(v_existing.id) IS DISTINCT FROM v_fp THEN
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
        'rental_ids', to_jsonb(v_ids),
        'series_status', v_existing.status,
        'hold_expires_at', v_existing.hold_expires_at
      );
    END IF;
  END IF;

  SELECT * INTO v_counts FROM _renter_unfinished_counts(v_org, v_renter);
  IF v_counts.unfinished_n + v_n > 32 THEN
    PERFORM _renter_raise('renter.booking.unfinishedLimit');
  END IF;

  INSERT INTO rental_series (
    organization_id, renter_id, contract_id, location_id, tariff_id,
    channel, valid_from, valid_to, status, purpose, idempotency_key,
    payload_fingerprint, created_by
  )
  VALUES (
    v_org, v_renter, NULL, v_loc, NULL,
    'miniapp', v_from, v_to, 'active',
    NULLIF(trim(p_payload ->> 'purpose'), ''),
    v_key, v_fp, v_member
  )
  RETURNING id INTO v_series_id;

  FOR v_slot IN SELECT value FROM jsonb_array_elements(v_slots) LOOP
    INSERT INTO rental_series_patterns (organization_id, series_id, days_of_week, time_start, time_end)
    VALUES (
      v_org,
      v_series_id,
      ARRAY[(v_slot ->> 'weekday')::int],
      v_slot ->> 'time_start',
      v_slot ->> 'time_end'
    );
  END LOOP;

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

  SELECT COALESCE(sum(r.prepay_amount), 0)
  INTO v_total_prepay
  FROM rentals r
  WHERE r.rental_series_id = v_series_id;

  v_available := _renter_wallet_available(v_org, v_renter);

  IF v_available >= v_total_prepay THEN
    PERFORM _renter_apply_wallet(v_org, v_renter);
  END IF;

  SELECT count(*)
  INTO v_awaiting
  FROM rentals r
  WHERE r.rental_series_id = v_series_id
    AND r.lifecycle = 'awaiting_payment';

  IF v_awaiting > 0 THEN
    UPDATE rentals
    SET lifecycle = 'awaiting_payment', updated_at = now()
    WHERE rental_series_id = v_series_id
      AND channel = 'miniapp'
      AND lifecycle IN ('active', 'prepaid_charged')
      AND prepay_charged_at IS NULL;

    v_hold := _renter_place_series_on_hold(v_org, v_series_id);

    RETURN jsonb_build_object(
      'success', true,
      'series_id', v_series_id,
      'rental_ids', to_jsonb(v_ids),
      'occurrence_count', v_n,
      'series_status', 'awaiting_payment',
      'hold_expires_at', v_hold
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'series_id', v_series_id,
    'rental_ids', to_jsonb(v_ids),
    'occurrence_count', v_n,
    'series_status', 'active'
  );
EXCEPTION
  WHEN unique_violation THEN
    IF v_key IS NOT NULL THEN
      SELECT * INTO v_existing
      FROM rental_series rs
      WHERE rs.organization_id = v_org AND rs.idempotency_key = v_key;
      IF FOUND THEN
        IF _renter_pack_series_fingerprint(v_existing.id) IS DISTINCT FROM v_fp THEN
          RETURN jsonb_build_object('success', false, 'error', 'renter.booking.idempotencyMismatch');
        END IF;
        SELECT COALESCE(array_agg(r.id), '{}')
        INTO v_ids
        FROM rentals r
        WHERE r.rental_series_id = v_existing.id;
        RETURN jsonb_build_object(
          'success', true,
          'already_applied', true,
          'series_id', v_existing.id,
          'rental_ids', to_jsonb(v_ids),
          'series_status', v_existing.status,
          'hold_expires_at', v_existing.hold_expires_at
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

COMMENT ON FUNCTION _renter_validate_pack_booking(uuid, uuid, uuid, date, date, int[], text, text, boolean) IS
  'FB2: pack validation wrapper; uniform weekdays+times → day_slots.';
COMMENT ON FUNCTION _renter_validate_pack_booking_slots(uuid, uuid, uuid, date, date, jsonb, boolean) IS
  'Pack quote/create validation with per-weekday time slots.';
COMMENT ON FUNCTION _renter_create_recurring_pack_inner(jsonb) IS
  'R1c/FA3/FA5/FB2/FDB1: pack create; per-weekday hours via day_slots.';
COMMENT ON FUNCTION renter_create_recurring_pack(jsonb) IS
  'R1c/FA3/FA5/FB2/FDB1 + iOS normalize; per-weekday day_slots.';

REVOKE ALL ON FUNCTION _renter_pack_day_slots_from_weekdays(int[], text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_pack_day_slots_canonical(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_pack_payload_fingerprint_slots(uuid, date, date, jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_pack_patterns_from_slots(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_pack_slots_from_series(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_validate_pack_booking_slots(uuid, uuid, uuid, date, date, jsonb, boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION _renter_pack_day_slots_from_weekdays(int[], text, text) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_pack_day_slots_canonical(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_pack_payload_fingerprint_slots(uuid, date, date, jsonb, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_pack_patterns_from_slots(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_pack_slots_from_series(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_validate_pack_booking_slots(uuid, uuid, uuid, date, date, jsonb, boolean) TO service_role;

COMMIT;
