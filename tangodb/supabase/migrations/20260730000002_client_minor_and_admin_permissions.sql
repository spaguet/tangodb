-- Client minor/guardian fields; admin payment & schedule permission toggles

BEGIN;

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS is_minor BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS guardian1_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS guardian1_phone TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS guardian1_telegram TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS guardian1_address TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS guardian2_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS guardian2_phone TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS guardian2_telegram TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS guardian2_address TEXT NOT NULL DEFAULT '';

ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS admin_can_accept_payments BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS admin_can_edit_schedule BOOLEAN NOT NULL DEFAULT true;

COMMIT;
