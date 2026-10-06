/**
 * E11 static smoke — role × edition nav (F122–F124). Complements rbac-regression-check.mjs.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  findFirstEnabledAccessiblePanelPath,
  findFirstAccessibleSettingsSection,
  canAccessPayrollRoute,
  isTeacherPayrollOnly,
} from "./permissions.ts";
import { editionAllows, type OrgEditionSnapshot } from "./orgEdition.ts";
import { normalizeOrgModules } from "./orgModules.ts";

const defaultModules = normalizeOrgModules({});

function editionSnapshot(active: "lite" | "studio" | "pro"): OrgEditionSnapshot {
  return {
    organizationId: "00000000-0000-4000-8000-000000000001",
    activeEdition: active,
    effectiveCeiling: active,
    persistedActiveEdition: active,
    liveMonthPhase: null,
    liveInstruments: [],
    caps: {
      locations: 1,
      disciplines: 1,
      clients_active: 50,
      members: 5,
      pending_invites: 0,
    },
    lifecycleEnabled: true,
  };
}

const teacherScope = {
  discipline_ids: ["d1"],
  location_ids: [],
  schedule_group_ids: [],
  all_disciplines: true,
  all_locations: false,
  all_groups: true,
  can_view_all_clients: true,
};

describe("E11 edition smoke (lifecycle on)", () => {
  it("accountant on Lite and Studio has no panel fallback (upsell Pro, F123)", () => {
    for (const ed of ["lite", "studio"] as const) {
      const path = findFirstEnabledAccessiblePanelPath("accountant", defaultModules, {
        edition: editionSnapshot(ed),
      });
      assert.equal(path, null, `accountant/${ed} must not fall back to finance loop`);
    }
  });

  it("teacher payroll-only on Lite does not home to /finance/payroll (F124)", () => {
    const edition = editionSnapshot("lite");
    const opts = { scope: teacherScope, edition };
    assert.equal(
      canAccessPayrollRoute("teacher", defaultModules, opts) && isTeacherPayrollOnly("teacher", opts),
      true
    );
    assert.equal(editionAllows(edition, "payroll"), false);
    const path = findFirstEnabledAccessiblePanelPath("teacher", defaultModules, opts);
    assert.notEqual(path, "/finance/payroll");
    assert.ok(path, "teacher should land on an operational panel");
  });

  it("reception on Lite lands on /attendance, not /subscriptions (F123)", () => {
    const path = findFirstEnabledAccessiblePanelPath("admin", defaultModules, {
      restrictedAdmin: true,
      edition: editionSnapshot("lite"),
    });
    assert.equal(path, "/attendance");
  });

  it("accountant on Lite has no settings fallback to hall-rent (F124)", () => {
    const section = findFirstAccessibleSettingsSection("accountant", defaultModules, {
      edition: editionSnapshot("lite"),
    });
    assert.equal(section, null);
  });

  it("lifecycle off preserves 2.11 accountant fallback to /finance", () => {
    const path = findFirstEnabledAccessiblePanelPath("accountant", defaultModules, {
      edition: { ...editionSnapshot("lite"), lifecycleEnabled: false },
    });
    assert.equal(path, "/finance");
  });
});
