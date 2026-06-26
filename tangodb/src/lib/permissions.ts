import type { MemberRole, OrgModules, TeacherScope } from "../types/organization";
import { isModuleEnabled, moduleKeyFromPanel, moduleKeyFromSettingsSection } from "./orgModules.ts";

export const EMPTY_TEACHER_SCOPE: TeacherScope = {
  discipline_ids: [],
  location_ids: [],
  all_disciplines: false,
  all_locations: false,
  can_view_all_clients: false,
};

export type PanelId =
  | "dashboard"
  | "finance"
  | "clients"
  | "subscriptions"
  | "subscriptions_sell"
  | "schedule"
  | "attendance"
  | "personal"
  | "personal_sell"
  | "prices"
  | "settings";

export type SettingsSectionId =
  | "general"
  | "organization"
  | "subscriptions"
  | "disciplines"
  | "locations"
  | "data"
  | "team"
  | "license";

export type PermissionAction =
  | "clients.read"
  | "clients.write"
  | "client_notes.read"
  | "client_notes.write"
  | "subscriptions.read"
  | "subscriptions.write"
  | "subscriptions.sell"
  | "attendance.read"
  | "attendance.write"
  | "schedule.read"
  | "schedule.write"
  | "personal_lessons.read"
  | "personal_lessons.write"
  | "personal_lessons.sell"
  | "prices.read"
  | "prices.write"
  | "disciplines.read"
  | "disciplines.write"
  | "dashboard.read"
  | "dashboard.scoped_summary"
  | "dashboard.export"
  | "reports.operational"
  | "reports.financial"
  | "finance.read"
  | "finance.export"
  | "payments.write"
  | "payments.read.operational"
  | "settings.manage"
  | "team.manage"
  | "license.view"
  | "license.activate";

export interface PermissionContext {
  disciplineId?: string | null;
  locationId?: string | null;
}

export interface PermissionOptions {
  scope?: TeacherScope;
  teachersCanManageDisciplines?: boolean;
  teachersCanSellSubscriptions?: boolean;
  teachersCanEditClients?: boolean;
  teachersCanExport?: boolean;
  teachersCanViewFullSchedule?: boolean;
  adminCanExport?: boolean;
  adminCanManageTeam?: boolean;
  restrictedAdmin?: boolean;
  isReadOnly?: boolean;
  context?: PermissionContext;
}

const STRATEGIC_ROLES: MemberRole[] = ["owner", "director"];
const OPERATIONAL_READ_ROLES: MemberRole[] = ["owner", "director", "admin"];
const FINANCIAL_READ_ROLES: MemberRole[] = ["owner", "director", "accountant"];

const WRITE_ACTIONS = new Set<PermissionAction>([
  "clients.write",
  "client_notes.write",
  "subscriptions.write",
  "subscriptions.sell",
  "attendance.write",
  "schedule.write",
  "personal_lessons.write",
  "personal_lessons.sell",
  "prices.write",
  "disciplines.write",
  "payments.write",
  "settings.manage",
  "team.manage",
  "license.activate",
]);

function isOperationalAdmin(role: MemberRole): boolean {
  return OPERATIONAL_READ_ROLES.includes(role);
}

export function isRestrictedReceptionAdmin(
  role: MemberRole | null,
  options?: PermissionOptions
): boolean {
  return role === "admin" && (options?.restrictedAdmin ?? false);
}

function isFullOperationalAdmin(role: MemberRole, options?: PermissionOptions): boolean {
  return isOperationalAdmin(role) && !isRestrictedReceptionAdmin(role, options);
}

function isReceptionAdmin(role: MemberRole, options?: PermissionOptions): boolean {
  return isRestrictedReceptionAdmin(role, options);
}

function hasDisciplineAccess(scope: TeacherScope, disciplineId?: string | null): boolean {
  if (!disciplineId) return false;
  if (scope.all_disciplines) return true;
  return scope.discipline_ids.includes(disciplineId);
}

function hasLocationAccess(scope: TeacherScope, locationId?: string | null): boolean {
  if (!locationId) return false;
  if (scope.all_locations) return true;
  return scope.location_ids.includes(locationId);
}

export function teacherHasAnyScopeAccess(scope: TeacherScope): boolean {
  return (
    scope.all_disciplines ||
    scope.all_locations ||
    scope.discipline_ids.length > 0 ||
    scope.location_ids.length > 0
  );
}

function teacherMatchesContext(scope: TeacherScope, context?: PermissionContext): boolean {
  if (!context?.disciplineId && !context?.locationId) {
    return teacherHasAnyScopeAccess(scope);
  }

  const disciplineOk = !context.disciplineId || hasDisciplineAccess(scope, context.disciplineId);
  const locationOk = !context.locationId || hasLocationAccess(scope, context.locationId);
  return disciplineOk && locationOk;
}

function canReadScopedCrm(
  role: MemberRole,
  scope: TeacherScope,
  context?: PermissionContext,
  options?: PermissionOptions
): boolean {
  if (isFullOperationalAdmin(role, options)) return true;
  if (role === "accountant") return false;
  if (role !== "teacher") return false;
  if (scope.can_view_all_clients) return true;
  return teacherMatchesContext(scope, context);
}

function canWriteScopedCrm(
  role: MemberRole,
  scope: TeacherScope,
  context?: PermissionContext,
  options?: PermissionOptions
): boolean {
  if (isFullOperationalAdmin(role, options)) return true;
  if (role !== "teacher") return false;
  return teacherMatchesContext(scope, context);
}

function canTeacherWriteClients(
  role: MemberRole,
  scope: TeacherScope,
  context?: PermissionContext,
  options?: PermissionOptions
): boolean {
  if (isFullOperationalAdmin(role, options)) return true;
  if (role !== "teacher") return false;
  if (!(options?.teachersCanEditClients ?? false)) return false;
  return teacherMatchesContext(scope, context);
}

function canTeacherReadSchedule(
  scope: TeacherScope,
  context?: PermissionContext,
  options?: PermissionOptions
): boolean {
  if (!teacherHasAnyScopeAccess(scope)) return false;
  if (options?.teachersCanViewFullSchedule ?? true) return true;
  return teacherMatchesContext(scope, context);
}

function canReceptionReadSubscriptions(role: MemberRole, options?: PermissionOptions): boolean {
  return isReceptionAdmin(role, options);
}

function canReceptionWrite(role: MemberRole, options?: PermissionOptions): boolean {
  return isReceptionAdmin(role, options);
}

function teachersCanSellSubscriptions(options?: PermissionOptions): boolean {
  return options?.teachersCanSellSubscriptions ?? false;
}

export function permissionOptionsFromSettings(
  settings: {
    teachers_can_manage_disciplines?: boolean;
    teachers_can_sell_subscriptions?: boolean;
    teachers_can_edit_clients?: boolean;
    teachers_can_export?: boolean;
    teachers_can_view_full_schedule?: boolean;
    admin_can_export?: boolean;
    admin_can_manage_team?: boolean;
  } | null,
  scope: TeacherScope,
  extras?: Pick<PermissionOptions, "restrictedAdmin" | "isReadOnly">
): PermissionOptions {
  return {
    scope,
    teachersCanManageDisciplines: settings?.teachers_can_manage_disciplines ?? false,
    teachersCanSellSubscriptions: settings?.teachers_can_sell_subscriptions ?? false,
    teachersCanEditClients: settings?.teachers_can_edit_clients ?? false,
    teachersCanExport: settings?.teachers_can_export ?? false,
    teachersCanViewFullSchedule: settings?.teachers_can_view_full_schedule ?? true,
    adminCanExport: settings?.admin_can_export ?? false,
    adminCanManageTeam: settings?.admin_can_manage_team ?? false,
    restrictedAdmin: extras?.restrictedAdmin ?? false,
    isReadOnly: extras?.isReadOnly ?? false,
  };
}

export function can(role: MemberRole | null, action: PermissionAction, options?: PermissionOptions): boolean {
  if (!role) return false;

  const scope = options?.scope ?? EMPTY_TEACHER_SCOPE;
  const context = options?.context;
  const isReadOnly = options?.isReadOnly ?? false;

  if (isReadOnly && WRITE_ACTIONS.has(action)) return false;

  if (isReceptionAdmin(role, options)) {
    switch (action) {
      case "subscriptions.read":
      case "attendance.read":
      case "attendance.write":
      case "payments.write":
        return true;
      default:
        return false;
    }
  }

  switch (action) {
    case "reports.operational":
      return isFullOperationalAdmin(role, options);

    case "reports.financial":
      return FINANCIAL_READ_ROLES.includes(role);

    case "dashboard.scoped_summary":
      if (role === "teacher") return teacherHasAnyScopeAccess(scope);
      return false;

    case "dashboard.read":
      return (
        can(role, "reports.operational", options) ||
        can(role, "reports.financial", options) ||
        can(role, "dashboard.scoped_summary", options)
      );

    case "dashboard.export":
      if (STRATEGIC_ROLES.includes(role)) return true;
      if (role === "admin" && (options?.adminCanExport ?? false)) return true;
      if (role === "teacher" && (options?.teachersCanExport ?? false)) {
        return teacherMatchesContext(scope, context);
      }
      return false;

    case "finance.read":
    case "finance.export":
      return FINANCIAL_READ_ROLES.includes(role);

    case "payments.write":
      return isFullOperationalAdmin(role, options) || canReceptionWrite(role, options);

    case "payments.read.operational":
      return isFullOperationalAdmin(role, options);

    case "clients.read":
      return canReadScopedCrm(role, scope, context, options);

    case "clients.write":
      return canTeacherWriteClients(role, scope, context, options);

    case "client_notes.read":
      return canReadScopedCrm(role, scope, context, options);

    case "client_notes.write":
      if (isFullOperationalAdmin(role, options)) return true;
      if (role !== "teacher") return false;
      return teacherMatchesContext(scope, context);

    case "subscriptions.read":
      if (canReceptionReadSubscriptions(role, options)) return true;
      return canReadScopedCrm(role, scope, context, options);

    case "attendance.read":
    case "attendance.write":
      if (canReceptionWrite(role, options)) return true;
      return canReadScopedCrm(role, scope, context, options);

    case "schedule.read":
      if (isFullOperationalAdmin(role, options)) return true;
      if (role === "teacher") return canTeacherReadSchedule(scope, context, options);
      return canReadScopedCrm(role, scope, context, options);

    case "personal_lessons.read":
      return canReadScopedCrm(role, scope, context, options);

    case "subscriptions.write":
    case "subscriptions.sell":
      if (role === "teacher") {
        return teachersCanSellSubscriptions(options) && teacherMatchesContext(scope, context);
      }
      return canWriteScopedCrm(role, scope, context, options);

    case "schedule.write":
    case "personal_lessons.write":
    case "personal_lessons.sell":
      return canWriteScopedCrm(role, scope, context, options);

    case "prices.read":
      return isFullOperationalAdmin(role, options) || role === "accountant";

    case "prices.write":
      return STRATEGIC_ROLES.includes(role);

    case "disciplines.read":
      if (isFullOperationalAdmin(role, options)) return true;
      if (role === "teacher") {
        return (
          (options?.teachersCanManageDisciplines ?? false) && teacherHasAnyScopeAccess(scope)
        );
      }
      return false;

    case "disciplines.write":
      if (STRATEGIC_ROLES.includes(role)) return true;
      if (role === "teacher") {
        if (!(options?.teachersCanManageDisciplines ?? false)) return false;
        return teacherMatchesContext(scope, context);
      }
      return false;

    case "settings.manage":
      return STRATEGIC_ROLES.includes(role);

    case "team.manage":
      if (STRATEGIC_ROLES.includes(role)) return true;
      if (role === "admin" && (options?.adminCanManageTeam ?? false)) return true;
      return false;

    case "license.view":
      return STRATEGIC_ROLES.includes(role);

    case "license.activate":
      return role === "owner";

    default:
      return false;
  }
}

export function canAccessPanel(
  role: MemberRole | null,
  panel: PanelId,
  options?: PermissionOptions
): boolean {
  if (isRestrictedReceptionAdmin(role, options)) {
    switch (panel) {
      case "attendance":
      case "subscriptions":
        return true;
      default:
        return false;
    }
  }

  switch (panel) {
    case "dashboard":
      return can(role, "dashboard.read", options);
    case "finance":
      return can(role, "finance.read", options);
    case "clients":
      return can(role, "clients.read", options);
    case "subscriptions":
      return can(role, "subscriptions.read", options);
    case "subscriptions_sell":
      return can(role, "subscriptions.sell", options);
    case "schedule":
      return can(role, "schedule.read", options);
    case "attendance":
      return can(role, "attendance.read", options);
    case "personal":
      return can(role, "personal_lessons.read", options);
    case "personal_sell":
      return can(role, "personal_lessons.sell", options);
    case "prices":
      if (role === "accountant") return false;
      return can(role, "prices.read", options);
    case "settings":
      if (can(role, "settings.manage", options)) return true;
      if (can(role, "finance.export", options) || can(role, "dashboard.export", options)) {
        return true;
      }
      if (can(role, "license.view", options)) return true;
      if (role === "teacher" && can(role, "disciplines.read", options)) return true;
      return false;
    default:
      return false;
  }
}

export function settingsSectionFromPath(pathname: string): SettingsSectionId | null {
  const match = pathname.match(/^\/settings\/([^/]+)/);
  if (!match) return null;
  const section = match[1] as SettingsSectionId;
  const valid: SettingsSectionId[] = [
    "general",
    "organization",
    "subscriptions",
    "disciplines",
    "locations",
    "data",
    "team",
    "license",
  ];
  return valid.includes(section) ? section : null;
}

export function canAccessSettingsSection(
  role: MemberRole | null,
  section: SettingsSectionId,
  options?: PermissionOptions
): boolean {
  switch (section) {
    case "general":
    case "organization":
    case "subscriptions":
    case "locations":
      return can(role, "settings.manage", options);
    case "disciplines":
      if (can(role, "settings.manage", options)) return true;
      if (role === "teacher" && can(role, "disciplines.read", options)) return true;
      return false;
    case "data":
      return can(role, "dashboard.export", options) || can(role, "finance.export", options);
    case "team":
      return can(role, "team.manage", options);
    case "license":
      return can(role, "license.view", options);
    default:
      return false;
  }
}

const PANEL_FALLBACK_PATHS: { panel: PanelId; path: string }[] = [
  { panel: "finance", path: "/finance" },
  { panel: "clients", path: "/clients" },
  { panel: "subscriptions", path: "/subscriptions" },
  { panel: "subscriptions_sell", path: "/subscriptions/sell" },
  { panel: "schedule", path: "/schedule" },
  { panel: "attendance", path: "/attendance" },
  { panel: "personal", path: "/personal" },
  { panel: "personal_sell", path: "/personal/sell" },
  { panel: "prices", path: "/prices" },
  { panel: "settings", path: "/settings" },
];

/** Первая доступная панель кроме dashboard — для RBAC-7 redirect с `/`. */
export function findFirstAccessiblePanelPath(
  role: MemberRole | null,
  options?: PermissionOptions
): string | null {
  for (const { panel, path } of PANEL_FALLBACK_PATHS) {
    if (canAccessPanel(role, panel, options)) return path;
  }
  return null;
}

const SETTINGS_SECTION_ORDER: SettingsSectionId[] = [
  "general",
  "organization",
  "subscriptions",
  "disciplines",
  "locations",
  "data",
  "team",
  "license",
];

export function canAccessDataExportSection(
  role: MemberRole | null,
  modules: OrgModules,
  options?: PermissionOptions
): boolean {
  const financial = isModuleEnabled(modules, "finance_basic") && can(role, "finance.export", options);
  const operational = can(role, "dashboard.export", options);
  return financial || operational;
}

export function findFirstAccessibleSettingsSection(
  role: MemberRole | null,
  modules: OrgModules,
  options?: PermissionOptions
): SettingsSectionId | null {
  for (const section of SETTINGS_SECTION_ORDER) {
    const moduleKey = moduleKeyFromSettingsSection(section);
    if (moduleKey && !isModuleEnabled(modules, moduleKey)) continue;
    if (section === "data" && !canAccessDataExportSection(role, modules, options)) continue;
    if (canAccessSettingsSection(role, section, options)) return section;
  }
  return null;
}

/** Первая доступная панель с учётом module gate. */
export function findFirstEnabledAccessiblePanelPath(
  role: MemberRole | null,
  modules: OrgModules,
  options?: PermissionOptions
): string | null {
  for (const { panel, path } of PANEL_FALLBACK_PATHS) {
    const moduleKey = moduleKeyFromPanel(panel);
    if (moduleKey && !isModuleEnabled(modules, moduleKey)) continue;
    if (canAccessPanel(role, panel, options)) return path;
  }
  return null;
}

export function panelIdFromPath(pathname: string): PanelId {
  if (pathname === "/") return "dashboard";
  if (pathname.startsWith("/finance")) return "finance";
  if (pathname === "/clients") return "clients";
  if (pathname === "/subscriptions/sell") return "subscriptions_sell";
  if (pathname.startsWith("/subscriptions")) return "subscriptions";
  if (pathname === "/schedule") return "schedule";
  if (pathname === "/attendance") return "attendance";
  if (pathname === "/personal/sell") return "personal_sell";
  if (pathname.startsWith("/personal")) return "personal";
  if (pathname === "/prices") return "prices";
  if (pathname.startsWith("/settings")) return "settings";
  return "dashboard";
}

/** R6 + Этап 0 regression checks — dev-only via main.tsx */
export function assertReceptionPermissions(): void {
  const receptionOpts: PermissionOptions = { restrictedAdmin: true };
  const adminOpts: PermissionOptions = { restrictedAdmin: false };
  const teacherScope: TeacherScope = {
    discipline_ids: ["d1"],
    location_ids: [],
    all_disciplines: false,
    all_locations: false,
    can_view_all_clients: false,
  };
  const teacherOpts: PermissionOptions = { scope: teacherScope };

  if (canAccessPanel("admin", "clients", receptionOpts)) {
    throw new Error("reception must not access clients panel");
  }
  if (canAccessPanel("admin", "schedule", receptionOpts)) {
    throw new Error("reception must not access schedule panel");
  }
  if (canAccessPanel("admin", "personal", receptionOpts)) {
    throw new Error("reception must not access personal panel");
  }
  if (canAccessPanel("admin", "personal_sell", receptionOpts)) {
    throw new Error("reception must not access personal_sell panel");
  }
  if (canAccessPanel("accountant", "personal", adminOpts)) {
    throw new Error("accountant must not access personal panel");
  }
  if (canAccessPanel("accountant", "personal_sell", adminOpts)) {
    throw new Error("accountant must not access personal_sell panel");
  }
  if (!canAccessPanel("admin", "attendance", receptionOpts)) {
    throw new Error("reception must access attendance panel");
  }
  if (!can("admin", "payments.write", receptionOpts)) {
    throw new Error("reception must write payments");
  }
  if (!canAccessPanel("admin", "clients", adminOpts)) {
    throw new Error("full admin must access clients panel");
  }

  if (canAccessPanel("accountant", "prices", adminOpts)) {
    throw new Error("accountant must not access prices panel (NAV-1)");
  }
  if (!can("accountant", "prices.read", adminOpts)) {
    throw new Error("accountant must retain prices.read for finance (NAV-1)");
  }
  if (can("teacher", "reports.operational", teacherOpts)) {
    throw new Error("teacher must not have reports.operational (NAV-2)");
  }
  if (!can("teacher", "dashboard.scoped_summary", teacherOpts)) {
    throw new Error("teacher with scope must have dashboard.scoped_summary (NAV-2)");
  }
  const emptyTeacherScope: TeacherScope = {
    discipline_ids: [],
    location_ids: [],
    all_disciplines: false,
    all_locations: false,
    can_view_all_clients: false,
  };
  const emptyTeacherOpts: PermissionOptions = { scope: emptyTeacherScope };
  if (can("teacher", "dashboard.scoped_summary", emptyTeacherOpts)) {
    throw new Error("teacher without scope must not have dashboard.scoped_summary (RBAC-4)");
  }
  if (canAccessPanel("teacher", "dashboard", emptyTeacherOpts)) {
    throw new Error("teacher without scope must not access dashboard panel (RBAC-4)");
  }
  if (!canAccessPanel("teacher", "dashboard", teacherOpts)) {
    throw new Error("teacher with scope must access dashboard panel (RBAC-4)");
  }
  if (can("admin", "disciplines.write", adminOpts)) {
    throw new Error("admin must not have disciplines.write (RBAC-6)");
  }
  if (!can("admin", "disciplines.read", adminOpts)) {
    throw new Error("admin must retain disciplines.read (RBAC-6)");
  }

  const adminExportOpts: PermissionOptions = { ...adminOpts, adminCanExport: true };
  if (!canAccessSettingsSection("admin", "data", adminExportOpts)) {
    throw new Error("admin with admin_can_export must access settings/data (RBAC-2)");
  }
  if (canAccessSettingsSection("admin", "data", adminOpts)) {
    throw new Error("admin without admin_can_export must not access settings/data (RBAC-2)");
  }

  if (can("accountant", "dashboard.export", adminOpts)) {
    throw new Error("accountant must not have dashboard.export (RBAC-8)");
  }
  if (!can("accountant", "finance.export", adminOpts)) {
    throw new Error("accountant must have finance.export (RBAC-8)");
  }
  const teacherNoExportOpts: PermissionOptions = { ...teacherOpts, teachersCanExport: false };
  if (can("teacher", "dashboard.export", teacherNoExportOpts)) {
    throw new Error("teacher without teachers_can_export must not export (RBAC-8)");
  }
  const teacherExportOpts: PermissionOptions = { ...teacherOpts, teachersCanExport: true };
  if (!can("teacher", "dashboard.export", teacherExportOpts)) {
    throw new Error("teacher with teachers_can_export and scope must export (RBAC-8)");
  }
}
