import { Navigate } from "react-router-dom";
import { usePermissions } from "../hooks/usePermissions";
import { useOrganization } from "../organization/OrganizationProvider";
import { findFirstAccessibleSettingsSection, permissionOptionsFromSettings } from "../lib/permissions";
import { normalizeOrgModules } from "../lib/orgModules";

export default function SettingsIndexRedirect() {
  const { role, scope, isReadOnly, membership } = usePermissions();
  const { settings } = useOrganization();
  const modules = normalizeOrgModules(settings?.modules);

  const options = permissionOptionsFromSettings(settings, scope, {
    restrictedAdmin: membership?.meta?.restricted_admin ?? false,
    isReadOnly,
  });

  const first = findFirstAccessibleSettingsSection(role, modules, options);
  return <Navigate to={first ? `/settings/${first}` : "/"} replace />;
}
