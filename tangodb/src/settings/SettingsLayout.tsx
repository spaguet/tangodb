import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Settings,
  Building2,
  Ticket,
  BookOpen,
  MapPin,
  Database,
  Users,
  KeyRound,
  Warehouse,
  CalendarDays,
  ChevronDown,
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
import { activeSettingsNavPath, isSettingsPrimarySection } from "../lib/settingsNavPaths";
import SettingsAccessNotice from "./components/SettingsAccessNotice";

const SETTINGS_NAV_ICONS: Record<SettingsSectionId, typeof Settings> = {
  general: Settings,
  organization: Building2,
  subscriptions: Ticket,
  disciplines: BookOpen,
  locations: MapPin,
  "hall-rent": Warehouse,
  data: Database,
  team: Users,
  integrations: CalendarDays,
  license: KeyRound,
};

const navLinkCls = (isActive: boolean) =>
  `flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-colors shrink-0 whitespace-nowrap ${
    isActive
      ? "bg-indigo-50 text-indigo-700 border border-indigo-100"
      : "text-slate-600 hover:bg-slate-50 border border-transparent"
  }`;

export default function SettingsLayout() {
  const { t } = useI18n();
  const location = useLocation();
  const { role, scope, isReadOnly, membership, can } = usePermissions();
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

  const primaryNav = useMemo(
    () => visibleNav.filter((item) => isSettingsPrimarySection(item.id)),
    [visibleNav]
  );
  const moreNav = useMemo(
    () => visibleNav.filter((item) => !isSettingsPrimarySection(item.id)),
    [visibleNav]
  );

  const activePath = activeSettingsNavPath(location.pathname);
  const moreRouteActive = moreNav.some((item) => item.path === activePath);
  const [moreOpen, setMoreOpen] = useState(moreRouteActive);
  const useSplitNav = primaryNav.length > 0 && moreNav.length > 0;

  useEffect(() => {
    if (moreRouteActive) setMoreOpen(true);
  }, [moreRouteActive]);

  const showAdminLimitedHint = role === "admin" && !can("settings.manage");

  const renderNavItem = (item: (typeof visibleNav)[number]) => {
    const Icon = item.icon;
    return (
      <NavLink key={item.id} to={item.path} className={({ isActive }) => navLinkCls(isActive)}>
        <Icon className="w-3.5 h-3.5 shrink-0" />
        {item.label}
      </NavLink>
    );
  };

  return (
    <div className="flex flex-col lg:flex-row gap-5 lg:gap-8">
      <SettingsAccessNotice />
      <nav className="lg:w-52 shrink-0">
        <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold px-1 mb-2">
          {t("settings.nav")}
        </p>

        {useSplitNav ? (
          <div className="lg:hidden space-y-2">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-1.5">
              {primaryNav.slice(0, 2).map((item) => renderNavItem(item))}
              <button
                type="button"
                onClick={() => setMoreOpen((open) => !open)}
                aria-expanded={moreOpen}
                className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer border ${
                  moreOpen || moreRouteActive
                    ? "bg-slate-100 text-slate-800 border-slate-200"
                    : "text-slate-600 hover:bg-slate-50 border-transparent"
                }`}
              >
                {t("settings.nav.more")}
                <ChevronDown
                  className={`w-3.5 h-3.5 shrink-0 transition-transform ${moreOpen ? "rotate-180" : ""}`}
                  aria-hidden
                />
              </button>
            </div>
            {moreOpen ? (
              <div className="flex overflow-x-auto gap-1.5 pb-0.5 -mx-0.5 px-0.5 snap-x snap-mandatory">
                {[...primaryNav.slice(2), ...moreNav].map((item) => renderNavItem(item))}
              </div>
            ) : null}
          </div>
        ) : null}

        <div
          className={`${useSplitNav ? "hidden lg:flex" : "flex"} lg:flex-col gap-1 overflow-x-auto lg:overflow-visible pb-1 lg:pb-0`}
        >
          {visibleNav.map((item) => renderNavItem(item))}
        </div>
      </nav>

      <div className="flex-1 min-w-0 space-y-4">
        {showAdminLimitedHint ? (
          <p className="text-xs text-slate-600 bg-amber-50/90 border border-amber-100 rounded-xl px-3.5 py-2.5 leading-relaxed">
            {t("settings.adminLimitedHint")}
          </p>
        ) : null}
        <Outlet />
      </div>
    </div>
  );
}
