/**
 * Regression QA §10 — static permission/nav matrix check.
 * Run: node scripts/rbac-regression-check.mjs
 */
import {
  can,
  canAccessPanel,
  canAccessSettingsSection,
  canManageVenueCostRules,
  canReadRentalTariffs,
  canSeeRentalTariffPrices,
  canWriteRentalTariffs,
  canAccessRentalInboxRoute,
  canAccessFinanceNav,
  isRentalInboxOnly,
  findFirstAccessiblePanelPath,
  findFirstEnabledAccessiblePanelPath,
  panelIdFromPath,
  assertReceptionPermissions,
  EMPTY_TEACHER_SCOPE,
} from "../src/lib/permissions.ts";
import { normalizeOrgModules } from "../src/lib/orgModules.ts";
import {
  canAddPersonalFromGrid,
  canOfferGroupLessonAdd,
} from "../src/lib/scheduleLessonAccess.ts";
import { canViewGroupAttendanceLesson } from "../src/lib/teacherAttendanceAccess.ts";
import {
  filterAccessibleLocations,
  locationIdsFromScheduleGroupScope,
} from "../src/hooks/useLocations.ts";

const ROLES = ["owner", "director", "admin", "teacher", "accountant"];
const defaultModules = normalizeOrgModules({});
const ALL_PANELS = [
  "dashboard",
  "finance",
  "clients",
  "subscriptions",
  "subscriptions_sell",
  "schedule",
  "attendance",
  "personal",
  "personal_sell",
  "prices",
  "settings",
];

const teacherScope = {
  discipline_ids: ["d1"],
  location_ids: [],
  schedule_group_ids: [],
  all_disciplines: true,
  all_locations: false,
  all_groups: true,
  can_view_all_clients: true,
};

const emptyTeacherScope = { ...EMPTY_TEACHER_SCOPE };

function optsFor(role, extras = {}) {
  const base = { restrictedAdmin: false, ...extras };
  if (role === "teacher") base.scope = extras.scope ?? teacherScope;
  return base;
}

const failures = [];

function fail(msg) {
  failures.push(msg);
  console.error("FAIL:", msg);
}

function assert(cond, msg) {
  if (!cond) fail(msg);
}

try {
  assertReceptionPermissions();
  console.log("OK: assertReceptionPermissions()");
} catch (e) {
  fail(String(e));
}

// §10.1 role spot checks
assert(can("owner", "license.activate", optsFor("owner")), "owner must activate license");
assert(!can("director", "license.activate", optsFor("director")), "director must not activate");
assert(can("director", "team.manage", optsFor("director")), "director must manage team");
assert(can("admin", "clients.write", optsFor("admin")), "admin CRM write");
assert(!can("admin", "settings.manage", optsFor("admin")), "admin no settings");
assert(!can("admin", "prices.write", optsFor("admin")), "admin no prices.write");
assert(!can("admin", "dashboard.export", optsFor("admin")), "admin no export by default");
assert(can("admin", "prices.read", optsFor("admin")), "admin prices.read");
assert(!can("admin", "disciplines.write", optsFor("admin")), "admin no disciplines.write (RBAC-6)");
assert(can("admin", "disciplines.read", optsFor("admin")), "admin disciplines.read (RBAC-6)");
assert(can("director", "attendance.write", optsFor("director")), "director attendance default");
assert(!can("director", "attendance.write", {
  ...optsFor("director"),
  directorsCanMarkAttendance: false,
}), "director no attendance when flag off");
assert(can("teacher", "personal_lessons.sell", {
  ...optsFor("teacher"),
  teachersCanSellPersonalLessons: true,
}), "teacher personal sell when org flag on");
assert(!can("teacher", "personal_lessons.sell", optsFor("teacher")), "teacher no personal sell default");
assert(can("teacher", "attendance.write", optsFor("teacher")), "teacher attendance");
assert(!can("teacher", "subscriptions.sell", optsFor("teacher")), "teacher no sub sell default");

const scopedGroupTeacher = {
  discipline_ids: [],
  location_ids: [],
  schedule_group_ids: ["group-1"],
  all_disciplines: false,
  all_locations: true,
  all_groups: false,
  can_view_all_clients: false,
};
assert(
  canViewGroupAttendanceLesson("teacher", "teacher-member-1", scopedGroupTeacher, {
    scheduleGroupId: "group-1",
    teacherMemberId: "other-teacher",
  }),
  "teacher sees group lesson when schedule group is in scope (not only when assigned)"
);
assert(
  !canViewGroupAttendanceLesson("teacher", "teacher-member-1", scopedGroupTeacher, {
    scheduleGroupId: "group-2",
    teacherMemberId: "teacher-member-1",
  }),
  "teacher cannot see group outside scope"
);
assert(
  filterAccessibleLocations(
    [{ id: "loc-1", name: "A", address: "" }],
    "teacher",
    { ...scopedGroupTeacher, all_locations: false, location_ids: [] },
    ["loc-1"]
  ).length === 1,
  "teacher locations include schedule group locations"
);
assert(
  locationIdsFromScheduleGroupScope(scopedGroupTeacher, [
    { id: "group-1", locationId: "loc-1" },
    { id: "group-2", locationId: "loc-2" },
  ]).join(",") === "loc-1",
  "locationIdsFromScheduleGroupScope maps scoped groups"
);

assert(!can("teacher", "subscriptions.sell", optsFor("teacher")), "teacher no sub sell default");
assert(can("teacher", "prices.read", optsFor("teacher")), "teacher prices.read with scope (for sales)");
assert(!can("teacher", "prices.read", { scope: emptyTeacherScope }), "empty teacher no prices.read");
assert(!canAccessPanel("teacher", "prices", optsFor("teacher")), "teacher no prices panel");
assert(
  can("teacher", "subscriptions.sell", {
    ...optsFor("teacher"),
    teachersCanSellSubscriptions: true,
  }),
  "teacher sub sell when org flag on"
);
assert(can("accountant", "finance.read", optsFor("accountant")), "accountant finance");
assert(can("accountant", "rentals.payments.write", optsFor("accountant")), "accountant rental cash");
assert(can("accountant", "rentals.write", optsFor("accountant")), "accountant rental slot write (stage 23)");
assert(!can("accountant", "schedule.write", optsFor("accountant")), "accountant no schedule.write (stage 23)");
assert(can("admin", "rentals.payments.write", optsFor("admin")), "admin rental cash");
assert(
  !can("admin", "rentals.payments.write", { ...optsFor("admin"), restrictedAdmin: true }),
  "reception no rental cash (stage 12)"
);
assert(
  !canReadRentalTariffs("admin", { ...optsFor("admin"), restrictedAdmin: true }),
  "reception no tariff lookup (stage 12)"
);
assert(
  !canSeeRentalTariffPrices("admin", { ...optsFor("admin"), restrictedAdmin: true }),
  "reception no tariff prices (stage 12)"
);
assert(
  !can("admin", "rentals.payments.write", { ...optsFor("admin"), adminCanAcceptPayments: false }),
  "admin no rental cash when payments flag off"
);
assert(!can("teacher", "rentals.payments.write", optsFor("teacher")), "teacher no rental cash");
assert(canAccessRentalInboxRoute("admin", defaultModules, optsFor("admin")), "admin rental inbox route");
assert(canAccessRentalInboxRoute("accountant", defaultModules, optsFor("accountant")), "accountant rental inbox route");
assert(
  !canAccessRentalInboxRoute("admin", defaultModules, { ...optsFor("admin"), restrictedAdmin: true }),
  "reception no rental inbox (stage 12)"
);
assert(isRentalInboxOnly("admin", optsFor("admin")), "admin is rental inbox only without finance.read");
assert(!isRentalInboxOnly("accountant", optsFor("accountant")), "accountant has finance.read");
assert(canAccessFinanceNav("admin", defaultModules, optsFor("admin")), "admin finance nav via inbox");
assert(
  canAccessFinanceNav("teacher", defaultModules, optsFor("teacher")),
  "teacher payroll-only finance nav"
);
assert(
  !canAccessFinanceNav("accountant", { ...defaultModules, finance_basic: false }, optsFor("accountant")),
  "accountant no finance nav without finance_basic module"
);
assert(!can("accountant", "clients.read", optsFor("accountant")), "accountant no clients");
assert(!canAccessPanel("accountant", "personal", optsFor("accountant")), "accountant no personal");
assert(!canAccessPanel("accountant", "personal_sell", optsFor("accountant")), "accountant no personal_sell");

// RBAC-1 dashboard split
for (const r of ["owner", "director"]) {
  assert(can(r, "reports.operational", optsFor(r)), `${r} operational`);
  assert(can(r, "reports.financial", optsFor(r)), `${r} financial`);
}
assert(can("admin", "reports.operational", optsFor("admin")), "admin operational only");
assert(!can("admin", "reports.financial", optsFor("admin")), "admin no financial");
assert(!can("accountant", "reports.operational", optsFor("accountant")), "accountant no operational");
assert(can("accountant", "reports.financial", optsFor("accountant")), "accountant financial");

// NAV expected counts
const navExpect = {
  owner: 11,
  director: 11,
  admin: 10,
  teacher: 7,
  accountant: 3,
};

for (const role of ROLES) {
  const o = optsFor(role);
  const visible = ALL_PANELS.filter((p) => canAccessPanel(role, p, o));
  const expected = navExpect[role];
  assert(
    visible.length === expected,
    `${role} nav: expected ${expected}, got ${visible.length} [${visible.join(", ")}]`
  );
}

// teacher empty scope — no nav
const emptyTeacherVisible = ALL_PANELS.filter((p) =>
  canAccessPanel("teacher", p, { scope: emptyTeacherScope })
);
assert(emptyTeacherVisible.length === 0, `empty teacher nav must be 0, got ${emptyTeacherVisible.length}`);

// RBAC-7 landing paths
const receptionOpts = { restrictedAdmin: true };
assert(!canAccessPanel("admin", "personal", receptionOpts), "reception no personal");
assert(!canAccessPanel("admin", "personal_sell", receptionOpts), "reception no personal_sell");
assert(
  findFirstAccessiblePanelPath("admin", receptionOpts) === "/subscriptions",
  "reception fallback path"
);
assert(
  findFirstAccessiblePanelPath("accountant", optsFor("accountant")) === "/finance",
  "accountant fallback"
);
assert(
  findFirstAccessiblePanelPath("teacher", { scope: emptyTeacherScope }) === null,
  "empty teacher no fallback"
);

// Module gate (Этап 1)
const soloModules = normalizeOrgModules({
  group_subscriptions: false,
  personal_lessons: true,
  pair_subscriptions: false,
  trio_lessons: false,
  multi_discipline: false,
  locations: false,
});
assert(!soloModules.group_subscriptions, "solo_teacher: group_subscriptions off");
assert(soloModules.finance_basic, "solo_teacher: finance_basic defaults true");
assert(
  findFirstEnabledAccessiblePanelPath("owner", soloModules, optsFor("owner")) === "/finance",
  "solo_teacher owner skips /subscriptions fallback"
);

const noFinanceModules = normalizeOrgModules({
  group_subscriptions: true,
  personal_lessons: true,
  pair_subscriptions: true,
  trio_lessons: true,
  multi_discipline: true,
  locations: true,
  finance_basic: false,
});
assert(
  findFirstEnabledAccessiblePanelPath("accountant", noFinanceModules, optsFor("accountant")) === "/renters",
  "accountant with finance_basic off falls back to renters CRM"
);
assert(
  findFirstEnabledAccessiblePanelPath("owner", noFinanceModules, optsFor("owner")) === "/clients",
  "owner with finance_basic off skips /finance"
);

// Schedule grid: sport_section-style org (group on, personal off)
const sportSectionModules = normalizeOrgModules({
  group_subscriptions: true,
  personal_lessons: false,
  pair_subscriptions: false,
  trio_lessons: false,
  multi_discipline: true,
  locations: true,
  finance_basic: true,
});
const gridOpts = { isReadOnly: false, modules: sportSectionModules };
const teacherSellOpts = {
  ...gridOpts,
  teachersCanSellSubscriptions: true,
};
const teacherGridCan = (action, context) =>
  can("teacher", action, { ...optsFor("teacher"), context });
assert(
  !canAddPersonalFromGrid("teacher", teacherGridCan, gridOpts),
  "teacher no personal add when personal_lessons module off"
);
assert(
  !can("teacher", "personal_lessons.sell", { ...optsFor("teacher"), modules: sportSectionModules }),
  "teacher no personal sell when personal_lessons module off"
);
assert(
  canOfferGroupLessonAdd("teacher", teacherGridCan, teacherSellOpts),
  "teacher group add when group module on and teachers_can_sell_subscriptions"
);
assert(
  !canOfferGroupLessonAdd("teacher", teacherGridCan, gridOpts),
  "teacher no group add without teachers_can_sell_subscriptions"
);
assert(
  canOfferGroupLessonAdd("owner", (action, context) => can("owner", action, { ...optsFor("owner"), context }), gridOpts),
  "owner group add when group module on"
);

// RBAC-2 settings guards
const adminExportOpts = { ...optsFor("admin"), adminCanExport: true };
assert(canAccessSettingsSection("admin", "data", adminExportOpts), "admin export settings");
assert(!canAccessSettingsSection("admin", "data", optsFor("admin")), "admin no data default");
assert(canAccessSettingsSection("accountant", "data", optsFor("accountant")), "accountant data");
assert(!canAccessSettingsSection("accountant", "general", optsFor("accountant")), "accountant no general");
assert(canAccessSettingsSection("accountant", "hall-rent", optsFor("accountant")), "accountant hall-rent");
assert(canReadRentalTariffs("accountant", optsFor("accountant")), "accountant read tariffs");
assert(!canWriteRentalTariffs("accountant", optsFor("accountant")), "accountant no write tariffs");
assert(canManageVenueCostRules("accountant"), "accountant manage venue cost");
assert(canAccessSettingsSection("admin", "hall-rent", optsFor("admin")), "admin hall-rent for stage 12 path");
assert(canSeeRentalTariffPrices("admin", optsFor("admin")), "admin sees tariff prices stage 12");
assert(canAccessPanel("admin", "settings", optsFor("admin")), "admin settings panel for lookup stage 12");
assert(!canAccessPanel("admin", "settings", { ...optsFor("admin"), restrictedAdmin: true }), "reception no settings");
assert(!canManageVenueCostRules("admin"), "admin no manage venue cost");
assert(!canWriteRentalTariffs("admin", optsFor("admin")), "admin no write tariffs without finance");
assert(canWriteRentalTariffs("owner", optsFor("owner")), "owner write tariffs");

// RBAC-8 export flags
assert(!can("accountant", "dashboard.export", optsFor("accountant")), "accountant no dashboard.export");
assert(can("accountant", "finance.export", optsFor("accountant")), "accountant finance.export");
const teacherExport = { ...optsFor("teacher"), teachersCanExport: true };
assert(can("teacher", "dashboard.export", teacherExport), "teacher export with flag");

console.log("\n--- Nav matrix ---");
for (const role of ROLES) {
  const o = optsFor(role);
  const paths = ALL_PANELS.filter((p) => canAccessPanel(role, p, o)).map((p) => p);
  console.log(`${role}: ${paths.join(", ")}`);
}

if (failures.length === 0) {
  console.log("\n✅ All regression checks passed (" + (ROLES.length + 20) + " assertions)");
  process.exit(0);
} else {
  console.error("\n❌ " + failures.length + " failure(s)");
  process.exit(1);
}
