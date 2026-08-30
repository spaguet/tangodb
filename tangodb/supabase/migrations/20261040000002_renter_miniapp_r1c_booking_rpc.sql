-- R1c / 2.9.3: Mini App public RPC (create/pack/cancel/quote/occupancy/cabinet).
-- JWT: actor=renter XOR member_can_manage_rentals() on write/quote. Occupancy/cabinet: renter only.

BEGIN;

CREATE OR REPLACE FUNCTION _renter_rpc_caught()
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION _renter_require_renter_ctx()
RETURNS TABLE (
  org_id uuid,
  renter_id uuid,
  telegram_id bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_ctx record;
BEGIN
  SELECT * INTO v_ctx FROM _renter_actor_ctx();
  IF NOT v_ctx.is_renter THEN
    PERFORM _renter_raise('renter.forbidden');
  END IF;
  org_id := v_ctx.org_id;
  renter_id := v_ctx.jwt_renter_id;
  telegram_id := v_ctx.telegram_id;
  RETURN NEXT;
END;
$$;

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
  p_created_by uuid
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
BEGIN
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
    p_org_id, p_renter_id, p_location_id, p_time_start, p_time_end
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
    NULL,
    NULL,
    NULL,
    p_idempotency_key,
    p_created_by,
    v_created
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Cabinet (renter only)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION renter_bootstrap()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_ctx record;
  v_name text;
  v_branding text;
  v_tz text;
  v_currency text;
  v_locale text;
BEGIN
  SELECT * INTO v_ctx FROM _renter_require_renter_ctx();

  SELECT o.name, os.branding_name, os.timezone, os.currency_code, os.locale
  INTO v_name, v_branding, v_tz, v_currency, v_locale
  FROM organizations o
  JOIN organization_settings os ON os.organization_id = o.id
  WHERE o.id = v_ctx.org_id;

  RETURN jsonb_build_object(
    'success', true,
    'studio_name', COALESCE(NULLIF(trim(v_branding), ''), v_name),
    'timezone', COALESCE(v_tz, 'UTC'),
    'currency_code', COALESCE(v_currency, 'RUB'),
    'locale', COALESCE(v_locale, 'ru'),
    'chat_url', NULL,
    'addon_active', renter_miniapp_addon_is_active(v_ctx.org_id)
  );
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION renter_list_locations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_ctx record;
  v_today date;
  v_rows jsonb;
BEGIN
  SELECT * INTO v_ctx FROM _renter_require_renter_ctx();
  v_today := _org_local_date(v_ctx.org_id);

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('id', l.id, 'name', l.name)
    ORDER BY l.name
  ), '[]'::jsonb)
  INTO v_rows
  FROM locations l
  WHERE l.organization_id = v_ctx.org_id
    AND l.miniapp_enabled
    AND _renter_location_has_three_kinds(v_ctx.org_id, l.id, v_today);

  RETURN jsonb_build_object('success', true, 'locations', v_rows);
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION renter_update_profile(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_ctx record;
  v_name text;
  v_phone text;
BEGIN
  SELECT * INTO v_ctx FROM _renter_require_renter_ctx();

  v_name := left(trim(COALESCE(p_payload ->> 'display_name', '')), 80);
  IF v_name IS NULL OR length(v_name) = 0 THEN
    PERFORM _renter_raise('renter.profile.displayNameInvalid');
  END IF;

  v_phone := normalize_renter_phone(p_payload ->> 'contact_phone');

  UPDATE renters
  SET
    display_name = v_name,
    contact_phone = v_phone,
    updated_at = now()
  WHERE id = v_ctx.renter_id
    AND organization_id = v_ctx.org_id;

  RETURN jsonb_build_object(
    'success', true,
    'display_name', v_name,
    'contact_phone', v_phone
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

CREATE OR REPLACE FUNCTION renter_get_wallet(
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
  v_total integer;
  v_rows jsonb;
BEGIN
  SELECT * INTO v_ctx FROM _renter_require_renter_ctx();
  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 50), 100));
  v_offset := GREATEST(COALESCE(p_offset, 0), 0);

  SELECT count(*)
  INTO v_total
  FROM renter_wallet_ledger l
  WHERE l.organization_id = v_ctx.org_id
    AND l.renter_id = v_ctx.renter_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', x.id,
      'entry_type', x.entry_type,
      'amount', x.amount,
      'rental_id', x.rental_id,
      'phase', x.phase,
      'created_at', x.created_at
    ) ORDER BY x.created_at DESC, x.id DESC
  ), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT l.id, l.entry_type, l.amount, l.rental_id, l.phase, l.created_at
    FROM renter_wallet_ledger l
    WHERE l.organization_id = v_ctx.org_id
      AND l.renter_id = v_ctx.renter_id
    ORDER BY l.created_at DESC, l.id DESC
    LIMIT v_limit OFFSET v_offset
  ) x;

  RETURN jsonb_build_object(
    'success', true,
    'wallet_balance', _renter_wallet_balance(v_ctx.org_id, v_ctx.renter_id),
    'spendable', _renter_wallet_spendable(v_ctx.org_id, v_ctx.renter_id),
    'reserved_prepay', _renter_wallet_reserved_prepay(v_ctx.org_id, v_ctx.renter_id),
    'debt_amount', _renter_wallet_debt_outstanding(v_ctx.org_id, v_ctx.renter_id),
    'entries', v_rows,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset
  );
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

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
      AND s.valid_from <= gs::date
      AND (s.valid_to IS NULL OR s.valid_to >= gs::date)
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

-- ---------------------------------------------------------------------------
-- Quote (renter XOR member_can_manage_rentals)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION renter_quote_booking(p_payload jsonb)
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
  v_kind text;
  v_quote jsonb;
  v_win record;
  v_from date;
  v_to date;
  v_weekdays int[];
  v_occ jsonb := '[]'::jsonb;
  v_item jsonb;
  v_d date;
  v_dow integer;
  v_busy boolean;
BEGIN
  SELECT * INTO v_ctx FROM _renter_actor_ctx();
  v_org := v_ctx.org_id;

  IF NOT renter_miniapp_addon_is_active(v_org) THEN
    PERFORM _renter_raise('renter.addonInactive');
  END IF;

  v_loc := NULLIF(p_payload ->> 'location_id', '')::uuid;
  v_start := normalize_hhmm(p_payload ->> 'time_start');
  v_end := normalize_hhmm(p_payload ->> 'time_end');
  PERFORM _renter_validate_slot_grid(v_start, v_end);

  IF p_payload ? 'valid_from' THEN
    v_from := (p_payload ->> 'valid_from')::date;
    v_to := (p_payload ->> 'valid_to')::date;
    IF v_from IS NULL OR v_to IS NULL OR v_to < v_from OR (v_to - v_from) > 27 THEN
      PERFORM _renter_raise('renter.booking.packWindow');
    END IF;

    IF p_payload -> 'weekdays' IS NOT NULL THEN
      SELECT COALESCE(array_agg(value::int), '{}')
      INTO v_weekdays
      FROM jsonb_array_elements_text(p_payload -> 'weekdays') t(value);
    ELSE
      SELECT COALESCE(array_agg(value::int), '{}')
      INTO v_weekdays
      FROM jsonb_array_elements_text(p_payload -> 'days_of_week') t(value);
    END IF;

    IF v_weekdays IS NULL OR cardinality(v_weekdays) = 0 THEN
      PERFORM _renter_raise('renter.booking.packWindow');
    END IF;

    IF NOT _renter_location_channel_ok(v_org, v_loc, v_from) THEN
      PERFORM _renter_raise('renter.booking.locationUnavailable');
    END IF;

    v_renter := COALESCE(v_ctx.jwt_renter_id, NULLIF(p_payload ->> 'renter_id', '')::uuid);
    v_kind := _renter_effective_kind(v_org, v_renter, 'recurring');

    FOR v_d IN SELECT gs::date FROM generate_series(v_from, v_to, interval '1 day') gs LOOP
      v_dow := EXTRACT(ISODOW FROM v_d)::integer;
      IF NOT (v_dow = ANY (v_weekdays)) THEN
        CONTINUE;
      END IF;
      v_busy := _renter_location_slot_busy(v_org, v_d, v_start, v_end, v_loc);
      v_quote := _renter_quote_slot_amounts(v_org, v_loc, v_kind, v_d, v_start, v_end);
      v_occ := v_occ || jsonb_build_array(
        v_quote || jsonb_build_object(
          'date', v_d,
          'time_start', v_start,
          'time_end', v_end,
          'busy', v_busy
        )
      );
    END LOOP;

    RETURN jsonb_build_object(
      'success', true,
      'kind', v_kind,
      'valid_from', v_from,
      'valid_to', v_to,
      'occurrences', v_occ
    );
  END IF;

  v_date := (p_payload ->> 'rental_date')::date;
  SELECT * INTO v_win FROM _renter_occupancy_window(v_org);
  IF v_date IS NULL OR v_date < v_win.window_start OR v_date > v_win.window_end THEN
    PERFORM _renter_raise('renter.booking.outsideWindow');
  END IF;

  IF NOT _renter_location_channel_ok(v_org, v_loc, v_date) THEN
    PERFORM _renter_raise('renter.booking.locationUnavailable');
  END IF;

  v_renter := COALESCE(v_ctx.jwt_renter_id, NULLIF(p_payload ->> 'renter_id', '')::uuid);
  v_kind := _renter_effective_kind(v_org, v_renter, 'one_time');
  v_quote := _renter_quote_slot_amounts(v_org, v_loc, v_kind, v_date, v_start, v_end);
  v_busy := _renter_location_slot_busy(v_org, v_date, v_start, v_end, v_loc);

  RETURN jsonb_build_object(
    'success', true,
    'busy', v_busy
  ) || v_quote;
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
  WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.booking.fieldsInvalid');
END;
$$;

-- ---------------------------------------------------------------------------
-- Create one-time
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

-- ---------------------------------------------------------------------------
-- Pack 4 weeks
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

  -- First occurrence date must equal valid_from
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

-- ---------------------------------------------------------------------------
-- Cancel / delete hold
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION renter_cancel_occurrence(p_rental_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_ctx record;
  v_r rentals%ROWTYPE;
  v_reason text;
  v_extra jsonb;
BEGIN
  SELECT * INTO v_ctx FROM _renter_actor_ctx();

  SELECT * INTO v_r FROM rentals WHERE id = p_rental_id;
  IF NOT FOUND OR v_r.organization_id IS DISTINCT FROM v_ctx.org_id OR v_r.channel <> 'miniapp' THEN
    PERFORM _renter_raise('renter.forbidden');
  END IF;
  IF v_ctx.is_renter AND v_r.renter_id IS DISTINCT FROM v_ctx.jwt_renter_id THEN
    PERFORM _renter_raise('renter.forbidden');
  END IF;

  v_extra := jsonb_build_array(
    jsonb_build_object('location_id', v_r.location_id, 'date', v_r.rental_date)
  );
  PERFORM _renter_acquire_miniapp_locks(v_ctx.org_id, v_r.renter_id, v_extra);

  v_reason := _renter_cancel_one_slot(p_rental_id, v_ctx.is_renter, v_ctx.member_id);

  RETURN jsonb_build_object(
    'success', true,
    'reason', v_reason,
    'rental', _renter_public_rental_json(p_rental_id)
  );
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION renter_cancel_pack(p_series_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_ctx record;
  v_s rental_series%ROWTYPE;
  v_slot record;
  v_now timestamptz := now();
  v_start timestamptz;
  v_extra jsonb := '[]'::jsonb;
  v_reasons jsonb := '[]'::jsonb;
  v_reason text;
BEGIN
  SELECT * INTO v_ctx FROM _renter_actor_ctx();

  SELECT * INTO v_s FROM rental_series WHERE id = p_series_id;
  IF NOT FOUND OR v_s.organization_id IS DISTINCT FROM v_ctx.org_id OR v_s.channel <> 'miniapp' THEN
    PERFORM _renter_raise('renter.forbidden');
  END IF;
  IF v_ctx.is_renter AND v_s.renter_id IS DISTINCT FROM v_ctx.jwt_renter_id THEN
    PERFORM _renter_raise('renter.forbidden');
  END IF;

  FOR v_slot IN
    SELECT r.id, r.location_id, r.rental_date, r.time_start, r.lifecycle
    FROM rentals r
    WHERE r.rental_series_id = p_series_id
      AND r.channel = 'miniapp'
  LOOP
    v_extra := v_extra || jsonb_build_array(
      jsonb_build_object('location_id', v_slot.location_id, 'date', v_slot.rental_date)
    );
  END LOOP;

  PERFORM _renter_acquire_miniapp_locks(v_ctx.org_id, v_s.renter_id, v_extra);

  FOR v_slot IN
    SELECT r.id, r.rental_date, r.time_start, r.lifecycle, r.organization_id
    FROM rentals r
    WHERE r.rental_series_id = p_series_id
      AND r.channel = 'miniapp'
      AND r.lifecycle IN ('awaiting_payment', 'active', 'prepaid_charged')
  LOOP
    v_start := _renter_slot_ts(v_slot.organization_id, v_slot.rental_date, v_slot.time_start);
    IF v_ctx.is_renter AND v_now >= v_start THEN
      CONTINUE;
    END IF;
    IF v_slot.lifecycle = 'awaiting_payment' THEN
      PERFORM _renter_delete_hold_slot(v_slot.id, v_ctx.member_id);
      v_reason := 'hold_deleted';
    ELSE
      v_reason := _renter_cancel_one_slot(v_slot.id, v_ctx.is_renter, v_ctx.member_id);
    END IF;
    v_reasons := v_reasons || jsonb_build_array(
      jsonb_build_object('rental_id', v_slot.id, 'reason', v_reason)
    );
  END LOOP;

  PERFORM _renter_after_pack_slot_terminal(p_series_id);

  RETURN jsonb_build_object(
    'success', true,
    'series_id', p_series_id,
    'cancelled', v_reasons
  );
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION renter_delete_hold(p_rental_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_ctx record;
  v_r rentals%ROWTYPE;
  v_extra jsonb;
BEGIN
  SELECT * INTO v_ctx FROM _renter_actor_ctx();

  SELECT * INTO v_r FROM rentals WHERE id = p_rental_id;
  IF NOT FOUND OR v_r.organization_id IS DISTINCT FROM v_ctx.org_id OR v_r.channel <> 'miniapp' THEN
    PERFORM _renter_raise('renter.forbidden');
  END IF;
  IF v_ctx.is_renter AND v_r.renter_id IS DISTINCT FROM v_ctx.jwt_renter_id THEN
    PERFORM _renter_raise('renter.forbidden');
  END IF;

  v_extra := jsonb_build_array(
    jsonb_build_object('location_id', v_r.location_id, 'date', v_r.rental_date)
  );
  PERFORM _renter_acquire_miniapp_locks(v_ctx.org_id, v_r.renter_id, v_extra);

  PERFORM _renter_delete_hold_slot(p_rental_id, v_ctx.member_id);

  RETURN jsonb_build_object(
    'success', true,
    'rental', _renter_public_rental_json(p_rental_id)
  );
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Grants: public RPC to authenticated; internals stay owner/service_role
REVOKE ALL ON FUNCTION _renter_rpc_caught() FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_require_renter_ctx() FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_insert_occurrence(uuid, uuid, uuid, date, text, text, text, uuid, text, uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION renter_bootstrap() FROM PUBLIC;
REVOKE ALL ON FUNCTION renter_list_locations() FROM PUBLIC;
REVOKE ALL ON FUNCTION renter_update_profile(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION renter_list_mine(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION renter_get_wallet(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION renter_get_occupancy(uuid, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION renter_quote_booking(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION renter_create_booking(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION renter_create_recurring_pack(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION renter_cancel_occurrence(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION renter_cancel_pack(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION renter_delete_hold(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION renter_bootstrap() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION renter_list_locations() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION renter_update_profile(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION renter_list_mine(integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION renter_get_wallet(integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION renter_get_occupancy(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION renter_quote_booking(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION renter_create_booking(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION renter_create_recurring_pack(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION renter_cancel_occurrence(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION renter_cancel_pack(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION renter_delete_hold(uuid) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION _renter_expire_and_catchup(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_lock_candidate_pairs(uuid, uuid, jsonb) TO service_role;

COMMIT;
