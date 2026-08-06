-- Manual expenses: payee and primary document number for accountant exports.
BEGIN;

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS payee TEXT,
  ADD COLUMN IF NOT EXISTS document_number TEXT;

COMMENT ON COLUMN expenses.payee IS 'Counterparty / payee for manual expense (primary document).';
COMMENT ON COLUMN expenses.document_number IS 'Invoice or receipt number for manual expense.';

COMMIT;
