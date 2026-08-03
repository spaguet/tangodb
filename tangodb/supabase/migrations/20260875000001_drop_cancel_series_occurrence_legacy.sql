-- Drop legacy cancel_rental_series_occurrence overload (ambiguous with stage 15 version).

BEGIN;

DROP FUNCTION IF EXISTS cancel_rental_series_occurrence(uuid, date, text, text, numeric);

COMMIT;
