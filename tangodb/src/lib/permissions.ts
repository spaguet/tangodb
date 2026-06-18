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
  | "clients"
  | "subscriptions"
  | "subscriptions_sell"
  | "schedule"
  | "attendance"
  | "personal"
  | "personal_sell"
  | "prices";

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
  isReadOnly?: boolean;
  context?: PermissionContext;
}

const ADMIN_ROLES: MemberRole[] = ["owner", "director", "admin"];
const READ_ALL_ROLES: MemberRole[] = [...ADMIN_ROLES, "accountant"];

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
  "settings.manage",
  "team.manage",
  "license.activate",
]);

function isAdminRole(role: MemberRole): boolean {
  return ADMIN_ROLES.includes(role);
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
  if (READ_ALL_ROLES.includes(role)) return true;
  if (role !== "teacher") return false;
  if (scope.can_view_all_clients) return true;
  return teacherMatchesContext(scope, context);
}

function canWriteScopedCrm(
  role: MemberRole,
  scope: TeacherScope,
  context?: PermissionContext
): boolean {
  if (isAdminRole(role)) return true;
  if (role !== "teacher") return false;
  return teacherMatchesContext(scope, context);
}

export function can(role: MemberRole | null, action: PermissionAction, options?: PermissionOptions): boolean {
  if (!role) return false;

  const scope = options?.scope ?? EMPTY_TEACHER_SCOPE;
  const context = options?.context;
  const isReadOnly = options?.isReadOnly ?? false;

  if (isReadOnly && WRITE_ACTIONS.has(action)) return false;

  switch (action) {
    case "dashboard.read":
      return true;

    case "dashboard.export":
      if (READ_ALL_ROLES.includes(role)) return true;
      if (role === "teacher") return teacherMatchesContext(scope, context);
      return false;

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
    case "attendance.write":
    case "schedule.write":
    case "personal_lessons.write":
    case "personal_lessons.sell":
      return canWriteScopedCrm(role, scope, context);

    case "prices.read":
      return isAdminRole(role) || role === "accountant";

    case "prices.write":
      return isAdminRole(role);

    case "disciplines.read":
      if (isAdminRole(role) || role === "accountant") return true;
      if (role === "teacher") {
        return (
          (options?.teachersCanManageDisciplines ?? false) && teacherHasAnyScopeAccess(scope)
        );
      }
      return false;

    case "disciplines.write":
      if (isAdminRole(role)) return true;
      if (role === "teacher") {
        if (!(options?.teachersCanManageDisciplines ?? false)) return false;
        return teacherMatchesContext(scope, context);
      }
      return false;

    case "settings.manage":
      return isAdminRole(role);

    case "team.manage":
      return isAdminRole(role);

    case "license.view":
      return role === "owner" || role === "director" || role === "admin";

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
    default:
      return false;
  }
}

export function panelIdFromPath(pathname: string): PanelId {
  if (pathname === "/") return "dashboard";
  if (pathname === "/clients") return "clients";
  if (pathname === "/subscriptions/sell") return "subscriptions_sell";
  if (pathname.startsWith("/subscriptions")) return "subscriptions";
  if (pathname === "/schedule") return "schedule";
  if (pathname === "/attendance") return "attendance";
  if (pathname === "/personal/sell") return "personal_sell";
  if (pathname.startsWith("/personal")) return "personal";
  if (pathname === "/prices") return "prices";
  return "dashboard";
}
