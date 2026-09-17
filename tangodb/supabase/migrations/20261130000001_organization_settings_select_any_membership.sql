-- UX04: multi-org picker / OrgSwitcher need branding_name before JWT active org is switched.
-- Existing policy scopes SELECT to auth_organization_id(); this adds read for any membership.

CREATE POLICY organization_settings_select_active_membership
  ON organization_settings FOR SELECT
  TO authenticated
  USING (
    is_active_member(auth.uid(), organization_id)
    AND organization_allows_reads(organization_id)
  );

COMMENT ON POLICY organization_settings_select_active_membership ON organization_settings IS
  'Allow members to read settings (incl. branding_name) for every org they belong to — needed for select-organization and org switcher.';
