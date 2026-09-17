-- UX16: org-wide toggle for in-app beginner hints and first-day checklist.

ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS show_beginner_hints BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN organization_settings.show_beginner_hints IS
  'When false, hides dismissible beginner hints and the first-day checklist for this organization.';
