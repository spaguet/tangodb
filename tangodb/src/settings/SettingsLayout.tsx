import { NavLink, Outlet } from "react-router-dom";
import {
  Settings,
  Building2,
  Ticket,
  BookOpen,
  MapPin,
  Database,
  Users,
  KeyRound,
  Coins,
  Warehouse,
} from "lucide-react";
import { usePermissions } from "../hooks/usePermissions";
import { useI18n } from "../hooks/useI18n";
import { useOrganization } from "../organization/OrganizationProvider";
import {
  canAccessDataExportSection,
  canAccessSettingsSection,
  permissionOptionsFromSettings,
  type SettingsSectionId,
} from "../lib/permissions";
import {
  isModuleEnabled,
  moduleKeyFromSettingsSection,
  normalizeOrgModules,
} from "../lib/orgModules";
import { getSettingsNav } from "../lib/i18n";

const SETTINGS_NAV_ICONS: Record<SettingsSectionId, typeof Settings> = {
  general: Settings,
  organization: Building2,
  subscriptions: Ticket,
  disciplines: BookOpen,
  locations: MapPin,
  "rental-tariffs": Coins,
  "venue-costs": Warehouse,
  data: Database,
  team: Users,
  license: KeyRound,
};

export default function SettingsLayout() {
  const { t } = useI18n();
  const { role, scope, isReadOnly, membership } = usePermissions();
  const { settings } = useOrganization();
  const modules = normalizeOrgModules(settings?.modules);
  const options = permissionOptionsFromSettings(settings, scope, {
    restrictedAdmin: membership?.meta?.restricted_admin ?? false,
    isReadOnly,
  });

  const settingsNav = getSettingsNav(t).map((item) => ({
    ...item,
    id: item.id as SettingsSectionId,
    icon: SETTINGS_NAV_ICONS[item.id as SettingsSectionId],
  }));

  const visibleNav = settingsNav.filter((item) => {
    const moduleKey = moduleKeyFromSettingsSection(item.id);
    if (moduleKey && !isModuleEnabled(modules, moduleKey)) return false;
    if (item.id === "data" && !canAccessDataExportSection(role, modules, options)) return false;
    return canAccessSettingsSection(role, item.id, options);
  });

  return (
    <div className="flex flex-col lg:flex-row gap-5 lg:gap-8">
      <nav className="lg:w-52 shrink-0">
        <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold px-1 mb-2">
          {t("settings.nav")}
        </p>
        <div className="flex lg:flex-col gap-1 overflow-x-auto pb-1 lg:pb-0">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.id}
                to={item.path}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                    isActive
                      ? "bg-indigo-50 text-indigo-700 border border-indigo-100"
                      : "text-slate-600 hover:bg-slate-50 border border-transparent"
                  }`
                }
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                {item.label}
              </NavLink>
            );
          })}
        </div>
      </nav>

      <div className="flex-1 min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
