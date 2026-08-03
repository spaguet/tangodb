-- Integration fix: stage 17 added fiscal params to record_rental_payment but left the
-- 6-arg overload from stage 9. Calls with operation_date become ambiguous in PostgreSQL.

BEGIN;

DROP FUNCTION IF EXISTS record_rental_payment(uuid, numeric, text, text, text, date);

COMMIT;
