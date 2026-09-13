-- Mini App / staff booking: optional purpose on each rental slot (schedule row).

CREATE OR REPLACE FUNCTION _renter_insert_occurrence(
  p_org_id uuid,
  p_renter_id uuid,
  p_location_id uuid,
  p_date date,
  p_time_start text,
  p_time_end text,
  p_kind text,
  p_series_id uuid,
  p_idempotency_key text,
  p_created_by uuid,
  p_purpose text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_quote jsonb;
  v_kind text;
  v_start_ts timestamptz;
  v_now timestamptz := now();
  v_created timestamptz := now();
  v_hold timestamptz;
  v_inherited timestamptz;
  v_id uuid;
  v_currency text;
  v_purpose text;
BEGIN
  v_purpose := NULLIF(left(trim(COALESCE(p_purpose, '')), 200), '');

  PERFORM _renter_validate_slot_grid(p_time_start, p_time_end);

  v_start_ts := _renter_slot_ts(p_org_id, p_date, p_time_start);
  IF v_start_ts < v_now + interval '1 hour' THEN
    PERFORM _renter_raise('renter.booking.tooSoon');
  END IF;

  IF NOT _renter_location_channel_ok(p_org_id, p_location_id, p_date) THEN
    PERFORM _renter_raise('renter.booking.locationUnavailable');
  END IF;

  IF _renter_location_slot_busy(p_org_id, p_date, p_time_start, p_time_end, p_location_id) THEN
    PERFORM _renter_raise('renter.booking.conflict');
  END IF;

  v_kind := _renter_effective_kind(p_org_id, p_renter_id, p_kind);
  v_quote := _renter_quote_slot_amounts(
    p_org_id, p_location_id, v_kind, p_date, p_time_start, p_time_end
  );
  v_currency := v_quote ->> 'currency';
  v_inherited := _renter_inherited_hold_expires_at(
    p_org_id, p_renter_id, p_location_id, p_date, p_time_start, p_time_end
  );
  v_hold := COALESCE(
    v_inherited,
    _renter_compute_hold_expires_at(v_created, v_start_ts)
  );

  INSERT INTO rentals (
    organization_id,
    location_id,
    rental_date,
    time_start,
    time_end,
    renter_id,
    rental_series_id,
    booking_status,
    channel,
    lifecycle,
    hold_expires_at,
    prepay_amount,
    remainder_amount,
    debt_amount,
    fixed_amount,
    calculated_amount,
    final_amount,
    currency,
    tariff_id,
    tariff_type,
    tariff_snapshot,
    purpose,
    idempotency_key,
    created_by,
    created_at
  )
  VALUES (
    p_org_id,
    p_location_id,
    p_date,
    normalize_hhmm(p_time_start),
    normalize_hhmm(p_time_end),
    p_renter_id,
    p_series_id,
    'confirmed',
    'miniapp',
    'awaiting_payment',
    v_hold,
    (v_quote ->> 'prepay')::numeric,
    (v_quote ->> 'remainder')::numeric,
    0,
    (v_quote ->> 'cost')::numeric,
    (v_quote ->> 'cost')::numeric,
    NULL,
    v_currency,
    NULLIF(v_quote ->> 'tariff_id', '')::uuid,
    v_quote ->> 'tariff_type',
    v_quote -> 'tariff_snapshot',
    v_purpose,
    p_idempotency_key,
    p_created_by,
    v_created
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

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
  v_purpose text;
  v_existing rentals%ROWTYPE;
  v_counts record;
  v_id uuid;
  v_extra jsonb;
  v_check jsonb;
  v_reasons text[];
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
  v_date := (p_payload ->> 'rental_date')::date;
  v_start := normalize_hhmm(p_payload ->> 'time_start');
  v_end := normalize_hhmm(p_payload ->> 'time_end');
  v_key := NULLIF(trim(p_payload ->> 'idempotency_key'), '');
  v_purpose := NULLIF(left(trim(COALESCE(p_payload ->> 'purpose', '')), 200), '');

  IF v_loc IS NULL OR v_date IS NULL OR v_start IS NULL OR v_end IS NULL THEN
    PERFORM _renter_raise('renter.booking.fieldsInvalid');
  END IF;

  v_check := _renter_validate_one_time_booking(
    v_org, v_renter, v_loc, v_date, v_start, v_end, 'one_time', true
  );
  SELECT COALESCE(array_agg(value), '{}')
  INTO v_reasons
  FROM jsonb_array_elements_text(v_check -> 'reasons') t(value);
  PERFORM _renter_raise_first_reason(v_reasons);

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
    'one_time', NULL, v_key, v_member, v_purpose
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
  'R1c/FA3/FB2: one-time create; optional purpose on rental slot.';


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
  v_purpose text;
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
  v_purpose := NULLIF(left(trim(COALESCE(p_payload ->> 'purpose', '')), 200), '');
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
      v_member,
      v_purpose
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

COMMENT ON FUNCTION _renter_create_recurring_pack_inner(jsonb) IS
  'Pack create; optional purpose copied to each rental slot.';

