-- FDB1 follow-up: drop legacy inline status CHECK name from rental_series_tariffs migration.

BEGIN;

ALTER TABLE rental_series
  DROP CONSTRAINT IF EXISTS rental_series_status_check;

ALTER TABLE rental_series
  DROP CONSTRAINT IF EXISTS rental_series_status_chk;

ALTER TABLE rental_series
  ADD CONSTRAINT rental_series_status_chk
    CHECK (status IN ('active', 'awaiting_payment', 'cancelled', 'completed'));

COMMIT;
