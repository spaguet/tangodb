-- S10 / H17, H18: rental billing and payroll settlements write only via RPC.
-- SPA already uses create_rental_*, record_rental_*, recalculate_teacher_settlement,
-- record_teacher_settlement_payment; SELECT policies unchanged.

BEGIN;

-- =============================================================================
-- 1. Rental money tables: REVOKE write; keep SELECT for financial roles
-- =============================================================================

REVOKE INSERT, UPDATE, DELETE ON rental_invoices FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON rental_invoice_lines FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON rental_invoice_payments FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON rental_advances FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON rental_advance_allocations FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON rental_deposits FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON rental_deposit_movements FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON rental_pricing_adjustments FROM anon, authenticated;

GRANT SELECT ON rental_invoices TO authenticated;
GRANT SELECT ON rental_invoice_lines TO authenticated;
GRANT SELECT ON rental_invoice_payments TO authenticated;
GRANT SELECT ON rental_advances TO authenticated;
GRANT SELECT ON rental_advance_allocations TO authenticated;
GRANT SELECT ON rental_deposits TO authenticated;
GRANT SELECT ON rental_deposit_movements TO authenticated;
GRANT SELECT ON rental_pricing_adjustments TO authenticated;

DROP POLICY IF EXISTS rental_invoices_write ON rental_invoices;
DROP POLICY IF EXISTS rental_invoice_lines_write ON rental_invoice_lines;
DROP POLICY IF EXISTS rental_invoice_payments_write ON rental_invoice_payments;
DROP POLICY IF EXISTS rental_advances_write ON rental_advances;
DROP POLICY IF EXISTS rental_advance_allocations_write ON rental_advance_allocations;
DROP POLICY IF EXISTS rental_deposits_write ON rental_deposits;
DROP POLICY IF EXISTS rental_deposit_movements_write ON rental_deposit_movements;
DROP POLICY IF EXISTS rental_pricing_adjustments_write ON rental_pricing_adjustments;

-- =============================================================================
-- 2. Payroll settlements: REVOKE write; payments only record_teacher_settlement_payment
-- =============================================================================

REVOKE INSERT, UPDATE, DELETE ON teacher_settlements FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON teacher_settlement_payments FROM anon, authenticated;

GRANT SELECT ON teacher_settlements TO authenticated;
GRANT SELECT ON teacher_settlement_payments TO authenticated;

DROP POLICY IF EXISTS teacher_settlements_insert ON teacher_settlements;
DROP POLICY IF EXISTS teacher_settlements_update ON teacher_settlements;
DROP POLICY IF EXISTS teacher_settlement_payments_insert ON teacher_settlement_payments;

COMMIT;
