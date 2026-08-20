-- M11 / P25: drop leftover 11-arg _record_personal_lesson_payment_impl.
-- 20260918000001 created the 11-arg overload; 20260920000001 added p_charge_id
-- via CREATE OR REPLACE without DROP, so both signatures can remain in the catalog.
-- Do not DROP the working 12-arg _impl or public record_personal_lesson_payment.
--
-- Note: 20260925000002 MUST be applied after 20260925000001.
-- 000001 used invalid GET DIAGNOSTICS v_deleted = v_deleted + ROW_COUNT.

BEGIN;

DROP FUNCTION IF EXISTS _record_personal_lesson_payment_impl(
  uuid, numeric, text, uuid, uuid, numeric, integer, numeric, text, integer, uuid
);

COMMIT;
