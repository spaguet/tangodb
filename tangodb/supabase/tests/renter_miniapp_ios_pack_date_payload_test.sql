-- iOS Mini App pack payload: localized dates must not 500; ISO prefix and weekdays parse.
-- Run: npm run test:db:renter-miniapp-ios-pack-date

BEGIN;

CREATE OR REPLACE FUNCTION _test_assert(p_condition boolean, p_message text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_condition THEN
    RAISE EXCEPTION 'ASSERT FAILED: %', p_message;
  END IF;
END;
$$;

DO $$
DECLARE
  v_weekdays int[];
  v_payload jsonb;
  v_norm jsonb;
BEGIN
  PERFORM _test_assert(
    _renter_parse_iso_date('2026-07-03') = DATE '2026-07-03',
    'plain ISO date'
  );
  PERFORM _test_assert(
    _renter_parse_iso_date('2026-07-03T00:00:00.000Z') = DATE '2026-07-03',
    'ISO datetime prefix'
  );
  PERFORM _test_assert(
    _renter_parse_iso_date('03 июля 2026') IS NULL,
    'localized iOS select text is not a date'
  );
  PERFORM _test_assert(
    _renter_parse_iso_date('') IS NULL,
    'empty date'
  );

  v_weekdays := _renter_parse_weekdays('{"weekdays":[1,5,3]}'::jsonb);
  PERFORM _test_assert(v_weekdays = ARRAY[1, 3, 5], 'numeric weekdays sorted unique');

  v_weekdays := _renter_parse_weekdays('{"weekdays":["2","4"]}'::jsonb);
  PERFORM _test_assert(v_weekdays = ARRAY[2, 4], 'string weekdays');

  v_weekdays := _renter_parse_weekdays('{"weekdays":"1,3"}'::jsonb);
  PERFORM _test_assert(v_weekdays = '{}'::int[], 'scalar weekdays not an array');

  v_payload := jsonb_build_object(
    'location_id', '00000000-0000-4000-8000-0000000000aa',
    'valid_from', '03 июля 2026',
    'valid_to', '2026-07-30T00:00:00.000Z',
    'weekdays', jsonb_build_array(5),
    'time_start', '18:00',
    'time_end', '20:00'
  );
  v_norm := _renter_normalize_booking_payload(v_payload);
  PERFORM _test_assert(v_norm -> 'valid_from' = 'null'::jsonb, 'bad valid_from becomes json null');
  PERFORM _test_assert((v_norm ->> 'valid_to') = '2026-07-30', 'valid_to prefix kept');
  PERFORM _test_assert((v_norm -> 'weekdays') = jsonb_build_array(5), 'weekdays kept');

  PERFORM _test_assert(normalize_hhmm('24:00') = '24:00', 'midnight end allowed');

  PERFORM _test_assert(
    (_renter_rpc_fields_invalid_if_unmapped(
      jsonb_build_object('success', false, 'error', 'invalid input syntax for type date')
    ) ->> 'error') = 'renter.booking.fieldsInvalid',
    'unmapped PG error remapped'
  );
  PERFORM _test_assert(
    (_renter_rpc_fields_invalid_if_unmapped(
      jsonb_build_object('success', false, 'error', 'renter.booking.packWindow')
    ) ->> 'error') = 'renter.booking.packWindow',
    'renter.* errors kept'
  );
END;
$$;

ROLLBACK;
