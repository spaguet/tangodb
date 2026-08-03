import type { MemberRole, OrgModules, TeacherScope } from "../types/organization.ts";
import { PRESET_MODULES } from "../types/organization.ts";
import {
  DEFAULT_ORG_MODULES,
  isModuleEnabled,
  moduleKeyFromPanel,
  moduleKeyFromSettingsSection,
} from "./orgModules.ts";

export const EMPTY_TEACHER_SCOPE: TeacherScope = {
  discipline_ids: [],
  location_ids: [],
  schedule_group_ids: [],
  all_disciplines: false,
  all_locations: false,
  all_groups: false,
  can_view_all_clients: false,
};

export type PanelId =
  | "dashboard"
  | "finance"
  | "clients"
  | "renters"
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
  | "hall-rent"
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
  | "expenses.read"
  | "expenses.write"
  | "payroll.read"
  | "payroll.read.own"
  | "payroll.write"
  | "payroll.rates.manage"
  | "payments.write"
  | "payments.read.operational"
  | "refunds.write"
  | "refunds.read"
  | "single_visits.record"
  | "settings.manage"
  | "team.manage"
  | "license.view"
  | "license.activate"
  | "renters.read"
  | "renters.write"
  | "renters.contacts.read"
  | "renters.contacts.write"
  | "renters.contracts.read"
  | "renters.contracts.write"
  | "renters.documents.read"
  | "renters.documents.write"
  | "renters.finance.read"
  /** Cash desk: record rental payment + see amount/paid/remaining (not full finance). */
  | "rentals.payments.write"
  /** Create/edit rental slots without full schedule.write (accountant narrow path). */
  | "rentals.write";

export interface PermissionContext {
  disciplineId?: string | null;
  locationId?: string | null;
}

export interface PermissionOptions {
  scope?: TeacherScope;
  modules?: OrgModules;
  teachersCanManageDisciplines?: boolean;
  teachersCanSellSubscriptions?: boolean;
  teachersCanSellPersonalLessons?: boolean;
  directorsCanMarkAttendance?: boolean;
  teachersCanEditClients?: boolean;
  teachersCanExport?: boolean;
  teachersCanViewFullSchedule?: boolean;
  adminCanExport?: boolean;
  adminCanManageTeam?: boolean;
  adminCanAcceptPayments?: boolean;
  adminCanEditSchedule?: boolean;
  teachersCanRecordSingleVisits?: boolean;
  adminCanRecordSingleVisits?: boolean;
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
    "single_visits.record",
  "expenses.write",
  "payroll.write",
  "payroll.rates.manage",
  "settings.manage",
  "team.manage",
  "license.activate",
  "renters.write",
  "renters.contacts.write",
  "renters.contracts.write",
  "renters.documents.write",
  "rentals.payments.write",
  "rentals.write",
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

function adminHasPaymentAccess(role: MemberRole, options?: PermissionOptions): boolean {
  if (role !== "admin") return true;
  if (isRestrictedReceptionAdmin(role, options)) return true;
  return options?.adminCanAcceptPayments ?? true;
}

function adminHasScheduleWriteAccess(role: MemberRole, options?: PermissionOptions): boolean {
  if (role !== "admin") return true;
  if (isRestrictedReceptionAdmin(role, options)) return false;
  return options?.adminCanEditSchedule ?? true;
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
    scope.all_groups ||
    scope.discipline_ids.length > 0 ||
    scope.location_ids.length > 0 ||
    scope.schedule_group_ids.length > 0
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

function teachersCanSellPersonalLessons(options?: PermissionOptions): boolean {
  return options?.teachersCanSellPersonalLessons ?? false;
}

function directorsCanMarkAttendance(options?: PermissionOptions): boolean {
  return options?.directorsCanMarkAttendance ?? true;
}

function canAccessAttendanceJournal(role: MemberRole, options?: PermissionOptions): boolean {
  if (canReceptionWrite(role, options)) return true;
  if (role === "owner") return true;
  if (role === "director") return directorsCanMarkAttendance(options);
  if (role === "admin") return isFullOperationalAdmin(role, options);
  if (role === "teacher") return teacherHasAnyScopeAccess(options?.scope ?? EMPTY_TEACHER_SCOPE);
  return false;
}

function personalLessonsModuleEnabled(options?: PermissionOptions): boolean {
  return isModuleEnabled(options?.modules ?? DEFAULT_ORG_MODULES, "personal_lessons");
}

export function permissionOptionsFromSettings(
  settings: {
    teachers_can_manage_disciplines?: boolean;
    teachers_can_sell_subscriptions?: boolean;
    teachers_can_sell_personal_lessons?: boolean;
    directors_can_mark_attendance?: boolean;
    teachers_can_edit_clients?: boolean;
    teachers_can_export?: boolean;
    teachers_can_view_full_schedule?: boolean;
    admin_can_export?: boolean;
    admin_can_manage_team?: boolean;
    admin_can_accept_payments?: boolean;
    admin_can_edit_schedule?: boolean;
    teachers_can_record_single_visits?: boolean;
    admin_can_record_single_visits?: boolean;
  } | null,
  scope: TeacherScope,
  extras?: Pick<PermissionOptions, "restrictedAdmin" | "isReadOnly">
): PermissionOptions {
  return {
    scope,
    teachersCanManageDisciplines: settings?.teachers_can_manage_disciplines ?? false,
    teachersCanSellSubscriptions: settings?.teachers_can_sell_subscriptions ?? false,
    teachersCanSellPersonalLessons: settings?.teachers_can_sell_personal_lessons ?? false,
    directorsCanMarkAttendance: settings?.directors_can_mark_attendance ?? true,
    teachersCanEditClients: settings?.teachers_can_edit_clients ?? false,
    teachersCanExport: settings?.teachers_can_export ?? false,
    teachersCanViewFullSchedule: settings?.teachers_can_view_full_schedule ?? true,
    adminCanExport: settings?.admin_can_export ?? false,
    adminCanManageTeam: settings?.admin_can_manage_team ?? false,
    adminCanAcceptPayments: settings?.admin_can_accept_payments ?? true,
    adminCanEditSchedule: settings?.admin_can_edit_schedule ?? true,
    teachersCanRecordSingleVisits: settings?.teachers_can_record_single_visits ?? false,
    adminCanRecordSingleVisits: settings?.admin_can_record_single_visits ?? true,
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
    case "expenses.read":
    case "expenses.write":
    case "payroll.read":
    case "payroll.write":
    case "refunds.read":
    case "refunds.write":
      return FINANCIAL_READ_ROLES.includes(role);

    case "payroll.read.own":
      return role === "teacher";

    case "payroll.rates.manage":
      return STRATEGIC_ROLES.includes(role);

    case "payments.write":
      if (canReceptionWrite(role, options)) return true;
      if (isFullOperationalAdmin(role, options)) {
        return adminHasPaymentAccess(role, options);
      }
      return false;

    case "single_visits.record":
      if (STRATEGIC_ROLES.includes(role)) return true;
      if (role === "admin" && isFullOperationalAdmin(role, options)) {
        return (options?.adminCanRecordSingleVisits ?? true) && adminHasPaymentAccess(role, options);
      }
      if (role === "teacher") {
        return (options?.teachersCanRecordSingleVisits ?? false) && teacherMatchesContext(scope, context);
      }
      return false;

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
      return canAccessAttendanceJournal(role, options);

    case "schedule.read":
      if (isFullOperationalAdmin(role, options)) return true;
      if (role === "teacher") return canTeacherReadSchedule(scope, context, options);
      return canReadScopedCrm(role, scope, context, options);

    case "personal_lessons.read":
      if (!personalLessonsModuleEnabled(options)) return false;
      return canReadScopedCrm(role, scope, context, options);

    case "subscriptions.write":
    case "subscriptions.sell":
      if (role === "teacher") {
        return teachersCanSellSubscriptions(options) && teacherMatchesContext(scope, context);
      }
      return canWriteScopedCrm(role, scope, context, options);

    case "schedule.write":
      if (isFullOperationalAdmin(role, options)) {
        return adminHasScheduleWriteAccess(role, options);
      }
      if (role === "teacher") {
        return teacherMatchesContext(scope, context);
      }
      return false;
    case "personal_lessons.write":
      if (!personalLessonsModuleEnabled(options)) return false;
      return canWriteScopedCrm(role, scope, context, options);
    case "personal_lessons.sell":
      if (!personalLessonsModuleEnabled(options)) return false;
      if (role === "teacher") {
        return teachersCanSellPersonalLessons(options) && teacherMatchesContext(scope, context);
      }
      return canWriteScopedCrm(role, scope, context, options);

    case "prices.read":
      if (isFullOperationalAdmin(role, options) || role === "accountant") return true;
      if (role === "teacher") return teacherHasAnyScopeAccess(scope);
      return false;

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

    case "renters.read":
      if (can(role, "schedule.write", options)) return true;
      return FINANCIAL_READ_ROLES.includes(role);

    case "renters.write":
    case "renters.contacts.write":
    case "renters.contracts.write":
      return can(role, "schedule.write", options);

    case "renters.contacts.read":
    case "renters.contracts.read":
      return can(role, "schedule.write", options);

    case "renters.documents.read":
    case "renters.documents.write":
      if (STRATEGIC_ROLES.includes(role)) return true;
      if (role === "admin" && !isRestrictedReceptionAdmin(role, options)) return true;
      return false;

    case "renters.finance.read":
      return FINANCIAL_READ_ROLES.includes(role);

    case "rentals.payments.write":
      // Finance roles keep rental cash via finance.read (no payments.write).
      if (FINANCIAL_READ_ROLES.includes(role)) return true;
      // Full operational admin: manage rentals ∧ payment-accept. Never bare payments.write
      // (restricted_admin already has payments.write).
      if (isRestrictedReceptionAdmin(role, options)) return false;
      if (isFullOperationalAdmin(role, options)) {
        return adminHasScheduleWriteAccess(role, options) && adminHasPaymentAccess(role, options);
      }
      return false;

    case "rentals.write":
      if (role === "accountant") return can(role, "finance.read", options);
      if (STRATEGIC_ROLES.includes(role)) return true;
      if (isFullOperationalAdmin(role, options) && adminHasScheduleWriteAccess(role, options)) return true;
      return false;

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
    case "renters":
      return can(role, "renters.read", options);
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
      if (role === "accountant" || role === "teacher") return false;
      return can(role, "prices.read", options);
    case "settings":
      if (can(role, "settings.manage", options)) return true;
      if (can(role, "finance.export", options) || can(role, "dashboard.export", options)) {
        return true;
      }
      if (can(role, "license.view", options)) return true;
      if (role === "teacher" && can(role, "disciplines.read", options)) return true;
      if (canReadRentalTariffs(role, options)) return true;
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
    "hall-rent",
    "data",
    "team",
    "license",
  ];
  return valid.includes(section) ? section : null;
}

/** Hall-rent settings: read rental tariff list (manage_rentals OR finance.read on backend). */
export function canReadRentalTariffs(role: MemberRole | null, options?: PermissionOptions): boolean {
  if (!role) return false;
  return can(role, "finance.read", options) || can(role, "schedule.write", options);
}

/** Tariff prices in list/lookup — same canonical cash gate as rental payments (stage 1/12). */
export function canSeeRentalTariffPrices(role: MemberRole | null, options?: PermissionOptions): boolean {
  if (!role) return false;
  return can(role, "finance.read", options) || can(role, "rentals.payments.write", options);
}

/** Write rental booking slots (narrow path for accountant; operational admin / owner / director). */
export function canWriteRentals(role: MemberRole | null, options?: PermissionOptions): boolean {
  if (!role) return false;
  return can(role, "rentals.write", options);
}

/** Hall-rent settings: write rental tariffs (manage_rentals + finance on backend). */
export function canWriteRentalTariffs(role: MemberRole | null, options?: PermissionOptions): boolean {
  if (!role) return false;
  return can(role, "schedule.write", options) && can(role, "finance.read", options);
}

/** Hall-rent settings: draft/accept venue cost rules (owner, director, accountant). */
export function canManageVenueCostRules(role: MemberRole | null): boolean {
  return role === "owner" || role === "director" || role === "accountant";
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
    case "hall-rent":
      return canReadRentalTariffs(role, options);
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
  { panel: "renters", path: "/renters" },
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
  "hall-rent",
  "data",
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
  if (canAccessPayrollRoute(role, modules, options) && isTeacherPayrollOnly(role, options)) {
    return "/finance/payroll";
  }

  if (canAccessRentalInboxRoute(role, modules, options) && isRentalInboxOnly(role, options)) {
    return "/finance/rental-inbox";
  }

  for (const { panel, path } of PANEL_FALLBACK_PATHS) {
    const moduleKey = moduleKeyFromPanel(panel);
    if (moduleKey && !isModuleEnabled(modules, moduleKey)) continue;
    if (canAccessPanel(role, panel, options)) return path;
  }
  return null;
}

/** Route-level access to `/finance/payroll` (teacher exception — not full finance panel). */
export function canAccessPayrollRoute(
  role: MemberRole | null,
  modules: OrgModules,
  options?: PermissionOptions
): boolean {
  if (!isModuleEnabled(modules, "finance_basic")) return false;
  return can(role, "payroll.read", options) || can(role, "payroll.read.own", options);
}

export function isTeacherPayrollOnly(role: MemberRole | null, options?: PermissionOptions): boolean {
  return can(role, "payroll.read.own", options) && !can(role, "finance.read", options);
}

/** Route-level access to `/finance/rental-inbox` (cashier queue — stage 22). */
export function canAccessRentalInboxRoute(
  role: MemberRole | null,
  modules: OrgModules,
  options?: PermissionOptions
): boolean {
  if (!isModuleEnabled(modules, "finance_basic")) return false;
  return can(role, "rentals.payments.write", options);
}

export function isRentalInboxOnly(role: MemberRole | null, options?: PermissionOptions): boolean {
  return can(role, "rentals.payments.write", options) && !can(role, "finance.read", options);
}

/** Main nav / finance workspace: full finance or rental inbox only. */
export function canAccessFinanceNav(
  role: MemberRole | null,
  modules: OrgModules,
  options?: PermissionOptions
): boolean {
  if (canAccessPanel(role, "finance", options)) return true;
  return canAccessRentalInboxRoute(role, modules, options);
}

export function panelIdFromPath(pathname: string): PanelId {
  if (pathname === "/") return "dashboard";
  if (pathname.startsWith("/finance")) return "finance";
  if (pathname === "/clients") return "clients";
  if (pathname.startsWith("/renters")) return "renters";
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
    schedule_group_ids: [],
    all_disciplines: false,
    all_locations: false,
    all_groups: false,
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
  if (can("admin", "rentals.payments.write", receptionOpts)) {
    throw new Error("reception must not record rental payments (stage 12: out of rental contour)");
  }
  if (canReadRentalTariffs("admin", receptionOpts)) {
    throw new Error("reception must not read rental tariffs (stage 12)");
  }
  if (canSeeRentalTariffPrices("admin", receptionOpts)) {
    throw new Error("reception must not see rental tariff prices (stage 12)");
  }
  if (!can("admin", "rentals.payments.write", adminOpts)) {
    throw new Error("full admin must record rental payments (hall-rent stage 1)");
  }
  if (can("admin", "rentals.payments.write", { ...adminOpts, adminCanAcceptPayments: false })) {
    throw new Error("full admin without payment accept must not record rental payments");
  }
  if (can("admin", "rentals.payments.write", { ...adminOpts, adminCanEditSchedule: false })) {
    throw new Error("full admin without schedule write must not record rental payments");
  }
  if (!can("accountant", "rentals.payments.write", adminOpts)) {
    throw new Error("accountant must retain rental payment via finance path");
  }
  if (!can("owner", "rentals.payments.write", adminOpts)) {
    throw new Error("owner must record rental payments");
  }
  if (!can("director", "rentals.payments.write", adminOpts)) {
    throw new Error("director must record rental payments");
  }
  if (can("teacher", "rentals.payments.write", teacherOpts)) {
    throw new Error("teacher must not record rental payments");
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
    schedule_group_ids: [],
    all_disciplines: false,
    all_locations: false,
    all_groups: false,
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

  if (!canAccessSettingsSection("accountant", "hall-rent", adminOpts)) {
    throw new Error("accountant must access hall-rent settings (stage 7)");
  }
  if (!canReadRentalTariffs("accountant", adminOpts)) {
    throw new Error("accountant must read rental tariffs (stage 7)");
  }
  if (canWriteRentalTariffs("accountant", adminOpts)) {
    throw new Error("accountant must not write rental tariffs (stage 7)");
  }
  if (!canManageVenueCostRules("accountant")) {
    throw new Error("accountant must manage venue cost rules (stage 7)");
  }
  if (!can("accountant", "rentals.write", adminOpts)) {
    throw new Error("accountant must write rental slots (stage 23)");
  }
  if (can("accountant", "schedule.write", adminOpts)) {
    throw new Error("accountant must not have schedule.write (stage 23)");
  }
  if (!canAccessSettingsSection("admin", "hall-rent", adminOpts)) {
    throw new Error("full admin must access hall-rent settings for stage 12 lookup path");
  }
  if (!canSeeRentalTariffPrices("admin", adminOpts)) {
    throw new Error("full admin must see rental tariff prices (stage 12)");
  }
  if (!canAccessPanel("admin", "settings", adminOpts)) {
    throw new Error("full admin must access settings panel for hall-rent lookup (stage 12)");
  }
  if (canAccessPanel("admin", "settings", receptionOpts)) {
    throw new Error("reception must not access settings panel (stage 12)");
  }
  if (canManageVenueCostRules("admin")) {
    throw new Error("admin must not manage venue cost rules (stage 7)");
  }
  if (!canWriteRentalTariffs("owner", adminOpts)) {
    throw new Error("owner must write rental tariffs (stage 7)");
  }
  if (!canWriteRentalTariffs("director", adminOpts)) {
    throw new Error("director must write rental tariffs (stage 7)");
  }
  if (canWriteRentalTariffs("admin", adminOpts)) {
    throw new Error("admin must not write rental tariffs without finance.read (stage 7)");
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

/** F6 payroll permission regression checks — dev-only via main.tsx */
export function assertPayrollPermissions(): void {
  const adminOpts: PermissionOptions = { restrictedAdmin: false };
  const teacherScope: TeacherScope = {
    discipline_ids: ["d1"],
    location_ids: [],
    schedule_group_ids: [],
    all_disciplines: false,
    all_locations: false,
    all_groups: false,
    can_view_all_clients: false,
  };
  const teacherOpts: PermissionOptions = { scope: teacherScope };
  const modules = PRESET_MODULES.dance_school;

  if (!can("owner", "payroll.read", adminOpts)) {
    throw new Error("owner must have payroll.read");
  }
  if (!can("accountant", "payroll.write", adminOpts)) {
    throw new Error("accountant must have payroll.write");
  }
  if (!can("teacher", "payroll.read.own", teacherOpts)) {
    throw new Error("teacher must have payroll.read.own");
  }
  if (can("teacher", "payroll.read", teacherOpts)) {
    throw new Error("teacher must not have payroll.read");
  }
  if (can("teacher", "payroll.write", teacherOpts)) {
    throw new Error("teacher must not have payroll.write");
  }
  if (!canAccessPayrollRoute("teacher", modules, teacherOpts)) {
    throw new Error("teacher must access payroll route with finance_basic");
  }
  if (canAccessPanel("teacher", "finance", teacherOpts)) {
    throw new Error("teacher must not access full finance panel");
  }
  if (!can("owner", "payroll.rates.manage", adminOpts)) {
    throw new Error("owner must manage payroll rates");
  }
  if (can("accountant", "payroll.rates.manage", adminOpts)) {
    throw new Error("accountant must not manage payroll rates");
  }
}
