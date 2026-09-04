-- FB2 / 2.9.43: P1-09 — unified quote/create validator; quote returns can_create, reasons, wallet fields.

BEGIN;

-- ---------------------------------------------------------------------------
-- Non-throwing create gate reasons (shared by quote and create)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION _renter_booking_gate_reasons(
  p_org_id uuid,
  p_renter_id uuid,
  p_need_addon boolean
)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_r renters%ROWTYPE;
  v_reasons text[] := '{}';
BEGIN
  IF p_renter_id IS NULL THEN
    RETURN v_reasons;
  END IF;

  IF p_need_addon AND NOT renter_miniapp_addon_is_active(p_org_id) THEN
    v_reasons := array_append(v_reasons, 'renter.addonInactive');
  END IF;

  IF NOT organization_allows_writes(p_org_id) THEN
    v_reasons := array_append(v_reasons, 'renter.orgWritesDisabled');
  END IF;

  SELECT * INTO v_r FROM renters WHERE id = p_renter_id AND organization_id = p_org_id;
  IF NOT FOUND THEN
    RETURN array_append(v_reasons, 'renter.forbidden');
  END IF;
  IF v_r.status IS DISTINCT FROM 'active' THEN
    v_reasons := array_append(v_reasons, 'renter.booking.inactive');
  END IF;
  IF v_r.booking_banned_at IS NOT NULL THEN
    v_reasons := array_append(v_reasons, 'renter.booking.banned');
  END IF;
  IF _renter_wallet_debt_outstanding(p_org_id, p_renter_id) > 0 THEN
    v_reasons := array_append(v_reasons, 'renter.booking.debt');
  END IF;

  RETURN v_reasons;
END;
$$;

COMMENT ON FUNCTION _renter_booking_gate_reasons(uuid, uuid, boolean) IS
  'FB2: non-throwing create gates for quote/create parity.';

CREATE OR REPLACE FUNCTION _renter_raise_first_reason(p_reasons text[])
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_reasons IS NOT NULL AND cardinality(p_reasons) > 0 THEN
    PERFORM _renter_raise(p_reasons[1]);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION _renter_one_time_quote_fingerprint(
  p_location_id uuid,
  p_rental_date date,
  p_time_start text,
  p_time_end text,
  p_renter_id uuid
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT md5(
    concat_ws(
      '|',
      p_location_id::text,
      p_rental_date::text,
      normalize_hhmm(p_time_start),
      normalize_hhmm(p_time_end),
      p_renter_id::text
    )
  );
$$;

COMMENT ON FUNCTION _renter_one_time_quote_fingerprint(uuid, date, text, text, uuid) IS
  'FB2: stable hash for one-time quote/create fingerprint.';

CREATE OR REPLACE FUNCTION _renter_quote_wallet_summary(
  p_org_id uuid,
  p_renter_id uuid,
  p_required_prepay numeric
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_debt numeric;
  v_spendable numeric;
  v_balance numeric;
  v_shortage numeric;
BEGIN
  IF p_renter_id IS NULL THEN
    RETURN jsonb_build_object('balance', NULL, 'shortage', NULL, 'debt_amount', NULL);
  END IF;

  v_debt := _renter_wallet_debt_outstanding(p_org_id, p_renter_id);
  v_spendable := _renter_wallet_spendable(p_org_id, p_renter_id);
  v_balance := CASE WHEN v_debt > 0 THEN 0 ELSE GREATEST(0, v_spendable) END;
  v_shortage := GREATEST(0, COALESCE(p_required_prepay, 0) - v_balance);
  IF v_debt > 0 AND COALESCE(p_required_prepay, 0) > 0 THEN
    v_shortage := v_debt + COALESCE(p_required_prepay, 0);
  END IF;

  RETURN jsonb_build_object(
    'balance', v_balance,
    'shortage', v_shortage,
    'debt_amount', v_debt
  );
END;
$$;

COMMENT ON FUNCTION _renter_quote_wallet_summary(uuid, uuid, numeric) IS
  'FB2: quote UI balance/shortage (§1.6: zero available while debt outstanding).';

CREATE OR REPLACE FUNCTION _renter_slot_block_reasons(
  p_org_id uuid,
  p_location_id uuid,
  p_date date,
  p_time_start text,
  p_time_end text,
  p_window_start date,
  p_window_end date,
  p_check_too_soon boolean DEFAULT true
)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reasons text[] := '{}';
  v_start_ts timestamptz;
BEGIN
  IF p_date IS NULL THEN
    RETURN v_reasons || 'renter.booking.fieldsInvalid';
  END IF;

  IF p_date < p_window_start OR p_date > p_window_end THEN
    v_reasons := array_append(v_reasons, 'renter.booking.outsideWindow');
  END IF;

  IF NOT _renter_location_channel_ok(p_org_id, p_location_id, p_date) THEN
    v_reasons := array_append(v_reasons, 'renter.booking.locationUnavailable');
  END IF;

  IF p_check_too_soon THEN
    v_start_ts := _renter_slot_ts(p_org_id, p_date, p_time_start);
    IF v_start_ts < now() + interval '1 hour' THEN
      v_reasons := array_append(v_reasons, 'renter.booking.tooSoon');
    END IF;
  END IF;

  IF _renter_location_slot_busy(p_org_id, p_date, p_time_start, p_time_end, p_location_id) THEN
    v_reasons := array_append(v_reasons, 'renter.booking.conflict');
  END IF;

  RETURN v_reasons;
END;
$$;

COMMENT ON FUNCTION _renter_slot_block_reasons(uuid, uuid, date, text, text, date, date, boolean) IS
  'FB2: per-slot blocking reasons (window, channel, tooSoon, conflict).';

CREATE OR REPLACE FUNCTION _renter_validate_one_time_booking(
  p_org_id uuid,
  p_renter_id uuid,
  p_location_id uuid,
  p_date date,
  p_time_start text,
  p_time_end text,
  p_kind text DEFAULT 'one_time',
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
  v_slot text[];
  v_quote jsonb;
  v_busy boolean;
  v_can_create boolean;
  v_wallet jsonb;
BEGIN
  BEGIN
    PERFORM _renter_validate_slot_grid(p_time_start, p_time_end);
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      RETURN jsonb_build_object(
        'can_create', false,
        'reasons', jsonb_build_array(SQLERRM),
        'busy', false
      );
  END;

  SELECT * INTO v_win FROM _renter_occupancy_window(p_org_id);
  v_slot := _renter_slot_block_reasons(
    p_org_id, p_location_id, p_date, p_time_start, p_time_end,
    v_win.window_start, v_win.window_end, true
  );
  v_reasons := v_reasons || v_slot;

  IF p_include_gates THEN
    v_gate := _renter_booking_gate_reasons(p_org_id, p_renter_id, true);
    v_reasons := v_reasons || v_gate;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT r), '{}')
  INTO v_reasons
  FROM unnest(v_reasons) r;

  v_busy := 'renter.booking.conflict' = ANY (v_reasons);

  BEGIN
    v_quote := _renter_quote_slot_amounts(
      p_org_id, p_location_id, p_kind, p_date, p_time_start, p_time_end
    );
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      v_reasons := array_append(v_reasons, SQLERRM);
      SELECT COALESCE(array_agg(DISTINCT r), '{}')
      INTO v_reasons
      FROM unnest(v_reasons) r;
      RETURN jsonb_build_object(
        'can_create', false,
        'reasons', to_jsonb(v_reasons),
        'busy', v_busy
      );
  END;

  v_can_create := cardinality(v_reasons) = 0;
  v_wallet := _renter_quote_wallet_summary(
    p_org_id,
    p_renter_id,
    (v_quote ->> 'prepay')::numeric
  );

  RETURN jsonb_build_object(
    'can_create', v_can_create,
    'reasons', to_jsonb(v_reasons),
    'busy', v_busy
  )
  || v_quote
  || v_wallet
  || jsonb_build_object(
    'fingerprint', _renter_one_time_quote_fingerprint(
      p_location_id, p_date, p_time_start, p_time_end, p_renter_id
    )
  );
END;
$$;

COMMENT ON FUNCTION _renter_validate_one_time_booking(uuid, uuid, uuid, date, text, text, text, boolean) IS
  'FB2: unified one-time quote/create validation with amounts and wallet summary.';

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
DECLARE
  v_win record;
  v_reasons text[] := '{}';
  v_gate text[];
  v_kind text;
  v_occ jsonb := '[]'::jsonb;
  v_item jsonb;
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
BEGIN
  BEGIN
    PERFORM _renter_validate_slot_grid(p_time_start, p_time_end);
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      RETURN jsonb_build_object(
        'can_create', false,
        'reasons', jsonb_build_array(SQLERRM),
        'occurrences', '[]'::jsonb
      );
  END;

  IF p_valid_from IS NULL OR p_valid_to IS NULL THEN
    v_reasons := array_append(v_reasons, 'renter.booking.fieldsInvalid');
  ELSIF p_valid_to <> p_valid_from + 27 THEN
    v_reasons := array_append(v_reasons, 'renter.booking.packWindow');
  END IF;

  IF p_weekdays IS NULL OR cardinality(p_weekdays) = 0 THEN
    v_reasons := array_append(v_reasons, 'renter.booking.packWindow');
  ELSIF p_valid_from IS NOT NULL
        AND NOT (EXTRACT(ISODOW FROM p_valid_from)::integer = ANY (p_weekdays)) THEN
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

  IF p_valid_from IS NOT NULL AND p_valid_to IS NOT NULL AND cardinality(COALESCE(p_weekdays, '{}')) > 0 THEN
    FOR v_d IN SELECT gs::date FROM generate_series(p_valid_from, p_valid_to, interval '1 day') gs LOOP
      v_dow := EXTRACT(ISODOW FROM v_d)::integer;
      IF NOT (v_dow = ANY (p_weekdays)) THEN
        CONTINUE;
      END IF;

      v_slot_reasons := _renter_slot_block_reasons(
        p_org_id, p_location_id, v_d, p_time_start, p_time_end,
        p_valid_from, p_valid_to, true
      );
      v_reasons := v_reasons || v_slot_reasons;

      v_busy := 'renter.booking.conflict' = ANY (v_slot_reasons);
      v_has_busy := v_has_busy OR v_busy;

      BEGIN
        v_quote := _renter_quote_slot_amounts(
          p_org_id, p_location_id, v_kind, v_d, p_time_start, p_time_end
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
          'time_start', p_time_start,
          'time_end', p_time_end,
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
    'fingerprint', _renter_pack_payload_fingerprint(
      p_location_id, p_valid_from, p_valid_to, p_weekdays, p_time_start, p_time_end, p_renter_id
    )
  );
END;
$$;

COMMENT ON FUNCTION _renter_validate_pack_booking(uuid, uuid, uuid, date, date, int[], text, text, boolean) IS
  'FB2: unified pack quote/create validation with totals and per-occurrence rows.';

-- ---------------------------------------------------------------------------
-- renter_quote_booking — unified validator output
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
  v_from date;
  v_to date;
  v_weekdays int[];
  v_result jsonb;
BEGIN
  SELECT * INTO v_ctx FROM _renter_actor_ctx();
  v_org := v_ctx.org_id;

  IF NOT renter_miniapp_addon_is_active(v_org) THEN
    PERFORM _renter_raise('renter.addonInactive');
  END IF;

  v_loc := NULLIF(p_payload ->> 'location_id', '')::uuid;
  v_start := normalize_hhmm(p_payload ->> 'time_start');
  v_end := normalize_hhmm(p_payload ->> 'time_end');

  v_renter := COALESCE(v_ctx.jwt_renter_id, NULLIF(p_payload ->> 'renter_id', '')::uuid);

  IF p_payload ? 'valid_from' THEN
    v_from := (p_payload ->> 'valid_from')::date;
    v_to := (p_payload ->> 'valid_to')::date;

    IF p_payload -> 'weekdays' IS NOT NULL THEN
      SELECT COALESCE(array_agg(value::int), '{}')
      INTO v_weekdays
      FROM jsonb_array_elements_text(p_payload -> 'weekdays') t(value);
    ELSE
      SELECT COALESCE(array_agg(value::int), '{}')
      INTO v_weekdays
      FROM jsonb_array_elements_text(p_payload -> 'days_of_week') t(value);
    END IF;

    v_result := _renter_validate_pack_booking(
      v_org, v_renter, v_loc, v_from, v_to, v_weekdays, v_start, v_end, true
    );

    RETURN jsonb_build_object('success', true) || v_result;
  END IF;

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

COMMENT ON FUNCTION renter_quote_booking(jsonb) IS
  'R1c/FB2: quote with can_create, reasons, cost/prepay/remainder, balance, shortage, fingerprint.';

-- ---------------------------------------------------------------------------
-- renter_create_booking — shared validator before locks
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
  'R1c/FA3/FB2: one-time create; unified validator before locks.';

-- ---------------------------------------------------------------------------
-- renter_create_recurring_pack — shared validator before locks
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
  v_fp text;
  v_weekdays int[];
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
  v_start := normalize_hhmm(p_payload ->> 'time_start');
  v_end := normalize_hhmm(p_payload ->> 'time_end');
  v_key := NULLIF(trim(p_payload ->> 'idempotency_key'), '');

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

  v_check := _renter_validate_pack_booking(
    v_org, v_renter, v_loc, v_from, v_to, v_weekdays, v_start, v_end, true
  );
  SELECT COALESCE(array_agg(value), '{}')
  INTO v_reasons
  FROM jsonb_array_elements_text(v_check -> 'reasons') t(value);
  PERFORM _renter_raise_first_reason(v_reasons);

  v_fp := v_check ->> 'fingerprint';
  v_n := COALESCE((v_check ->> 'occurrence_count')::int, 0);

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
          'rental_ids', to_jsonb(v_ids)
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

COMMENT ON FUNCTION renter_create_recurring_pack(jsonb) IS
  'R1c/FA3/FA5/FB2: pack create; unified validator before locks.';

REVOKE ALL ON FUNCTION _renter_booking_gate_reasons(uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_raise_first_reason(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_one_time_quote_fingerprint(uuid, date, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_quote_wallet_summary(uuid, uuid, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_slot_block_reasons(uuid, uuid, date, text, text, date, date, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_validate_one_time_booking(uuid, uuid, uuid, date, text, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_validate_pack_booking(uuid, uuid, uuid, date, date, int[], text, text, boolean) FROM PUBLIC;

COMMIT;
