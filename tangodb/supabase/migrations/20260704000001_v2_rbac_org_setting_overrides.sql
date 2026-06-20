-- TangoDB v2 RBAC §9: org-setting role overrides
-- Ref: tangodb_roles_rbac_TZ.md §9, prompt R1+R2

BEGIN;

ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS teachers_can_sell_subscriptions BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS teachers_can_edit_clients BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS teachers_can_export BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS teachers_can_view_full_schedule BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS admin_can_export BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS admin_can_manage_team BOOLEAN NOT NULL DEFAULT false;

COMMIT;
