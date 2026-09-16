-- Integration fix: fiscal stage added params to record_rental_invoice_payment but left the
-- 5-arg overload from rental_invoices_advances_ui. Calls with operation_date are ambiguous.

BEGIN;

DROP FUNCTION IF EXISTS record_rental_invoice_payment(uuid, numeric, text, text);
DROP FUNCTION IF EXISTS record_rental_invoice_payment(uuid, numeric, text, text, date);

COMMIT;
