import { Navigate } from "react-router-dom";
import { usePermissions } from "../hooks/usePermissions";
import { useOrganization } from "../organization/OrganizationProvider";
import { canAccessSettingsSection, type SettingsSectionId } from "../lib/permissions";

const SECTION_ORDER: SettingsSectionId[] = [
  "general",
  "organization",
  "subscriptions",
  "disciplines",
  "locations",
  "data",
  "team",
  "license",
];

export default function SettingsIndexRedirect() {
  const { role, scope, isReadOnly } = usePermissions();
  const { settings } = useOrganization();

  const options = {
    scope,
    teachersCanManageDisciplines: settings?.teachers_can_manage_disciplines ?? false,
    isReadOnly,
  };

  const first = SECTION_ORDER.find((section) => canAccessSettingsSection(role, section, options));
  return <Navigate to={first ? `/settings/${first}` : "/"} replace />;
}
