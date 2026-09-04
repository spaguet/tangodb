import type { MemberRole } from "../types/organization";
import type { PermissionOptions } from "./permissions";
import { can, isRentalInboxOnly } from "./permissions";

/** Whether the current member should see global pending top-up badge / inbox nav. */
export function showRenterTopupNav(
  role: MemberRole | null,
  options: PermissionOptions,
  teacherPayrollOnly: boolean
): boolean {
  if (teacherPayrollOnly) return false;
  const rentalInboxOnly = isRentalInboxOnly(role, options);
  return rentalInboxOnly || can(role, "rentals.payments.write", options);
}

export function isTopupSlaEscalationRole(role: MemberRole | null): boolean {
  return role === "owner" || role === "director";
}
