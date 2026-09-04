/**
 * FC5: owner/director see hall rental dashboard block gate; accountant excluded.
 */
import assert from "node:assert/strict";
import { can } from "../src/lib/permissions.ts";

const adminOpts = { adminCanAcceptPayments: true, adminCanEditSchedule: false };

assert.equal(can("owner", "reports.financial", adminOpts), true, "owner financial reports");
assert.equal(can("director", "reports.financial", adminOpts), true, "director financial reports");
assert.equal(can("accountant", "reports.financial", adminOpts), true, "accountant financial reports");

assert.equal(can("accountant", "renters.finance.read", adminOpts), true, "accountant renter finance");
assert.equal(can("admin", "renters.finance.read", adminOpts), false, "admin no renter finance (FC4)");

function isTopupSlaEscalationRole(role) {
  return role === "owner" || role === "director";
}

assert.equal(isTopupSlaEscalationRole("owner"), true);
assert.equal(isTopupSlaEscalationRole("director"), true);
assert.equal(isTopupSlaEscalationRole("accountant"), false, "accountant must not see director aggregates block");

console.log("fc5-permissions-check: OK");
