-- R0 follow-up: CHECK must reject miniapp rows with NULL lifecycle.
-- SQL CHECK treats NULL as pass; `channel = miniapp AND lifecycle IN (...)` was NULL, not FALSE.

BEGIN;

ALTER TABLE rentals
  DROP CONSTRAINT IF EXISTS rentals_channel_lifecycle_chk;

ALTER TABLE rentals
  ADD CONSTRAINT rentals_channel_lifecycle_chk
    CHECK (
      (channel = 'cashier') = (lifecycle IS NULL)
      AND (
        channel = 'cashier'
        OR lifecycle IN (
          'awaiting_payment',
          'active',
          'prepaid_charged',
          'settled',
          'debt',
          'cancelled',
          'auto_deleted',
          'hold_deleted'
        )
      )
    );

COMMIT;
