/**
 * FC4 permission smoke: payments without schedule; no finance/contacts bleed.
 */
import { can, canManageMiniAppRentals } from "../src/lib/permissions.ts";

const adminOpts = { restrictedAdmin: false, adminCanAcceptPayments: true, adminCanEditSchedule: true };
const paymentOnlyAdmin = { ...adminOpts, adminCanEditSchedule: false };

if (!can("admin", "rentals.payments.write", adminOpts)) {
  console.error("FAIL: full admin must have rentals.payments.write");
  process.exit(1);
}
if (!can("admin", "rentals.payments.write", paymentOnlyAdmin)) {
  console.error("FAIL: admin payment-only must have rentals.payments.write (FC4)");
  process.exit(1);
}
if (can("admin", "schedule.write", paymentOnlyAdmin)) {
  console.error("FAIL: admin payment-only must not have schedule.write");
  process.exit(1);
}
if (canManageMiniAppRentals("admin", paymentOnlyAdmin)) {
  console.error("FAIL: admin payment-only must not manage Mini App occupancy");
  process.exit(1);
}
if (can("admin", "renters.finance.read", adminOpts)) {
  console.error("FAIL: admin must not have renters.finance.read");
  process.exit(1);
}
if (can("admin", "renters.contacts.read", paymentOnlyAdmin)) {
  console.error("FAIL: admin payment-only must not have renters.contacts.read");
  process.exit(1);
}
if (can("admin", "rentals.payments.write", { ...adminOpts, restrictedAdmin: true })) {
  console.error("FAIL: reception must not have rentals.payments.write");
  process.exit(1);
}

console.log("fc4-permissions-check: OK");
