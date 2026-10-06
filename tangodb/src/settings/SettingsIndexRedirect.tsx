import { Navigate, useLocation } from "react-router-dom";
import EditionUpsellScreen from "../components/edition/EditionUpsellScreen";
import { usePermissions } from "../hooks/usePermissions";
import { useOrganization } from "../organization/OrganizationProvider";
import { findFirstAccessibleSettingsSection } from "../lib/permissions";
import { normalizeOrgModules } from "../lib/orgModules";

export default function SettingsIndexRedirect() {
  const location = useLocation();
  const { role, options } = usePermissions();
  const { settings } = useOrganization();
  const modules = normalizeOrgModules(settings?.modules);

  const first = findFirstAccessibleSettingsSection(role, modules, options);
  if (!first) {
    return <EditionUpsellScreen requiredEdition="pro" />;
  }
  return <Navigate to={`/settings/${first}`} replace state={location.state} />;
}
