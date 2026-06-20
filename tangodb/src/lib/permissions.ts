import type { MemberRole, TeacherScope } from "../types/organization";

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
  isReadOnly?: boolean;
  context?: PermissionContext;
}

const STRATEGIC_ROLES: MemberRole[] = ["owner", "director"];
const OPERATIONAL_READ_ROLES: MemberRole[] = ["owner", "director", "admin"];
const FINANCIAL_READ_ROLES: MemberRole[] = ["owner", "director", "accountant"];

/** §9: hardcoded until R2 migration adds organization_settings columns */
const DEFAULT_TEACHERS_CAN_SELL_SUBSCRIPTIONS = false;

const WRITE_ACTIONS = new Set<PermissionAction>([
  "clients.write",
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
  context?: PermissionContext
): boolean {
  if (isOperationalAdmin(role)) return true;
  if (role === "accountant") return false;
  if (role !== "teacher") return false;
  if (scope.can_view_all_clients) return true;
  return teacherMatchesContext(scope, context);
}

function canWriteScopedCrm(
  role: MemberRole,
  scope: TeacherScope,
  context?: PermissionContext
): boolean {
  if (isOperationalAdmin(role)) return true;
  if (role !== "teacher") return false;
  return teacherMatchesContext(scope, context);
}

function teachersCanSellSubscriptions(options?: PermissionOptions): boolean {
  return options?.teachersCanSellSubscriptions ?? DEFAULT_TEACHERS_CAN_SELL_SUBSCRIPTIONS;
}

export function can(role: MemberRole | null, action: PermissionAction, options?: PermissionOptions): boolean {
  if (!role) return false;

  const scope = options?.scope ?? EMPTY_TEACHER_SCOPE;
  const context = options?.context;
  const isReadOnly = options?.isReadOnly ?? false;

  if (isReadOnly && WRITE_ACTIONS.has(action)) return false;

  switch (action) {
    case "reports.operational":
      if (isOperationalAdmin(role)) return true;
      if (role === "teacher") return teacherHasAnyScopeAccess(scope);
      return false;

    case "reports.financial":
      return FINANCIAL_READ_ROLES.includes(role);

    case "dashboard.read":
      return (
        can(role, "reports.operational", options) || can(role, "reports.financial", options)
      );

    case "dashboard.export":
      if (STRATEGIC_ROLES.includes(role) || role === "accountant") return true;
      if (role === "teacher") return teacherMatchesContext(scope, context);
      return false;

    case "finance.read":
    case "finance.export":
      return FINANCIAL_READ_ROLES.includes(role);

    case "payments.write":
      return isOperationalAdmin(role);

    case "payments.read.operational":
      return isOperationalAdmin(role);

    case "clients.read":
      return canReadScopedCrm(role, scope, context);

    case "clients.write":
      return canWriteScopedCrm(role, scope, context);

    case "subscriptions.read":
    case "attendance.read":
    case "schedule.read":
    case "personal_lessons.read":
      return canReadScopedCrm(role, scope, context);

    case "subscriptions.write":
    case "subscriptions.sell":
      if (role === "teacher") {
        return teachersCanSellSubscriptions(options) && teacherMatchesContext(scope, context);
      }
      return canWriteScopedCrm(role, scope, context);

    case "attendance.write":
    case "schedule.write":
    case "personal_lessons.write":
    case "personal_lessons.sell":
      return canWriteScopedCrm(role, scope, context);

    case "prices.read":
      return isOperationalAdmin(role) || role === "accountant";

    case "prices.write":
      return STRATEGIC_ROLES.includes(role);

    case "disciplines.read":
      if (isOperationalAdmin(role)) return true;
      if (role === "teacher") {
        return (
          (options?.teachersCanManageDisciplines ?? false) && teacherHasAnyScopeAccess(scope)
        );
      }
      return false;

    case "disciplines.write":
      if (STRATEGIC_ROLES.includes(role)) return true;
      if (role === "admin") return true;
      if (role === "teacher") {
        if (!(options?.teachersCanManageDisciplines ?? false)) return false;
        return teacherMatchesContext(scope, context);
      }
      return false;

    case "settings.manage":
      return STRATEGIC_ROLES.includes(role);

    case "team.manage":
      return STRATEGIC_ROLES.includes(role);

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
