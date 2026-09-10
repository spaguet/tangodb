-- Mini App pack quote/create: iOS WKWebView may send localized dates / non-array weekdays.
-- Casts like '03 июля 2026'::date raise invalid_datetime_format (not caught) → HTTP 500.

BEGIN;

CREATE OR REPLACE FUNCTION normalize_hhmm(t TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  parts TEXT[];
  h INT;
  m INT;
BEGIN
  IF t IS NULL OR trim(t) = '' THEN
    RAISE EXCEPTION 'Invalid time format: empty';
  END IF;
  parts := string_to_array(trim(t), ':');
  IF array_length(parts, 1) < 2 THEN
    RAISE EXCEPTION 'Invalid time format: %', t;
  END IF;
  h := parts[1]::INT;
  m := split_part(parts[2], '.', 1)::INT;
  IF h = 24 AND m = 0 THEN
    RETURN '24:00';
  END IF;
  IF h < 0 OR h > 23 OR m < 0 OR m > 59 THEN
    RAISE EXCEPTION 'Invalid time values: %', t;
  END IF;
  RETURN lpad(h::TEXT, 2, '0') || ':' || lpad(m::TEXT, 2, '0');
END;
$$;

CREATE OR REPLACE FUNCTION _renter_parse_iso_date(p_text text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v text;
BEGIN
  v := NULLIF(btrim(p_text), '');
  IF v IS NULL THEN
    RETURN NULL;
  END IF;
  IF v ~ '^\d{4}-\d{2}-\d{2}' THEN
    RETURN substr(v, 1, 10)::date;
  END IF;
  RETURN v::date;
EXCEPTION
  WHEN invalid_datetime_format THEN
    RETURN NULL;
  WHEN datetime_field_overflow THEN
    RETURN NULL;
  WHEN invalid_text_representation THEN
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION _renter_parse_iso_date(text) IS
  'Mini App: YYYY-MM-DD or ISO datetime prefix → date; localized iOS select text → NULL.';

CREATE OR REPLACE FUNCTION _renter_parse_weekdays(p_payload jsonb)
RETURNS int[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_raw jsonb;
  v_out int[];
BEGIN
  v_raw := p_payload -> 'weekdays';
  IF v_raw IS NULL OR jsonb_typeof(v_raw) = 'null' THEN
    v_raw := p_payload -> 'days_of_week';
  END IF;
  IF v_raw IS NULL OR jsonb_typeof(v_raw) IS DISTINCT FROM 'array' THEN
    RETURN '{}';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT v ORDER BY v), '{}')
  INTO v_out
  FROM (
    SELECT value::int AS v
    FROM jsonb_array_elements_text(v_raw) t(value)
    WHERE value ~ '^[1-7]$'
  ) s;

  RETURN COALESCE(v_out, '{}');
EXCEPTION
  WHEN OTHERS THEN
    RETURN '{}';
END;
$$;

COMMENT ON FUNCTION _renter_parse_weekdays(jsonb) IS
  'Mini App pack weekdays from jsonb array of ints/strings 1–7; scalar/object → empty.';

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
    v_weekdays := _renter_parse_weekdays(v);
    v := jsonb_set(v, '{weekdays}', to_jsonb(v_weekdays));
  END IF;
  IF v ? 'rental_date' THEN
    v_one := _renter_parse_iso_date(v ->> 'rental_date');
    v := jsonb_set(v, '{rental_date}', CASE WHEN v_one IS NULL THEN 'null'::jsonb ELSE to_jsonb(v_one) END);
  END IF;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION _renter_rpc_fields_invalid_if_unmapped(p jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p IS NULL THEN jsonb_build_object('success', false, 'error', 'renter.booking.fieldsInvalid')
    WHEN COALESCE(p ->> 'success', '') = 'true' THEN p
    WHEN COALESCE(p ->> 'error', '') LIKE 'renter.%' THEN p
    ELSE jsonb_build_object('success', false, 'error', 'renter.booking.fieldsInvalid')
  END;
$$;

DO $$
BEGIN
  IF to_regprocedure('public._renter_quote_booking_inner(jsonb)') IS NULL THEN
    ALTER FUNCTION renter_quote_booking(jsonb) RENAME TO _renter_quote_booking_inner;
  END IF;
  IF to_regprocedure('public._renter_create_recurring_pack_inner(jsonb)') IS NULL THEN
    ALTER FUNCTION renter_create_recurring_pack(jsonb) RENAME TO _renter_create_recurring_pack_inner;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION renter_quote_booking(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  RETURN _renter_rpc_fields_invalid_if_unmapped(
    _renter_quote_booking_inner(_renter_normalize_booking_payload(p_payload))
  );
EXCEPTION
  WHEN invalid_datetime_format THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.booking.fieldsInvalid');
  WHEN datetime_field_overflow THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.booking.fieldsInvalid');
  WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.booking.fieldsInvalid');
  WHEN invalid_parameter_value THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.booking.fieldsInvalid');
END;
$$;

CREATE OR REPLACE FUNCTION renter_create_recurring_pack(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  RETURN _renter_rpc_fields_invalid_if_unmapped(
    _renter_create_recurring_pack_inner(_renter_normalize_booking_payload(p_payload))
  );
EXCEPTION
  WHEN invalid_datetime_format THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.booking.fieldsInvalid');
  WHEN datetime_field_overflow THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.booking.fieldsInvalid');
  WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.booking.fieldsInvalid');
  WHEN invalid_parameter_value THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.booking.fieldsInvalid');
END;
$$;

COMMENT ON FUNCTION renter_quote_booking(jsonb) IS
  'R1c/FB2 + iOS payload normalize: quote one-time or pack; unmapped PG errors → fieldsInvalid.';

COMMENT ON FUNCTION renter_create_recurring_pack(jsonb) IS
  'R1c/FA3/FA5/FB2/FDB1 + iOS payload normalize; unmapped PG errors → fieldsInvalid.';

REVOKE ALL ON FUNCTION _renter_parse_iso_date(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_parse_weekdays(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_normalize_booking_payload(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_rpc_fields_invalid_if_unmapped(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_quote_booking_inner(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _renter_create_recurring_pack_inner(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION renter_quote_booking(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION renter_create_recurring_pack(jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION _renter_quote_booking_inner(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_create_recurring_pack_inner(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION renter_quote_booking(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION renter_create_recurring_pack(jsonb) TO authenticated, service_role;

COMMIT;
