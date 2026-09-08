-- Allow recurring rental packs for 2, 3, or 4 calendar weeks (inclusive span).

CREATE OR REPLACE FUNCTION _renter_pack_span_days_ok(p_valid_from date, p_valid_to date)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT p_valid_from IS NOT NULL
     AND p_valid_to IS NOT NULL
     AND (p_valid_to - p_valid_from) IN (13, 20, 27);
$$;

COMMENT ON FUNCTION _renter_pack_span_days_ok(date, date) IS
  'Mini App recurring pack: 2/3/4 calendar weeks (valid_to = valid_from + 13/20/27).';

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
  ELSIF NOT _renter_pack_span_days_ok(p_valid_from, p_valid_to) THEN
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
  'FB2: unified pack quote/create validation; pack span 2/3/4 weeks.';
