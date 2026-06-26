import {
  buildClassTeacherMap,
  resolvePaymentTeacherId,
  type TeacherRevenueContext,
} from "./financeReports";
import type { Payment } from "../types";

export { resolvePaymentTeacherId, buildClassTeacherMap, type TeacherRevenueContext };

/** Client-side preview of accrued amount for one teacher in a month. Authoritative value — RPC. */
export function previewTeacherAccrued(
  payments: Payment[],
  teacherMemberId: string,
  ratePercent: number,
  ctx: TeacherRevenueContext
): number {
  if (ratePercent <= 0) return 0;

  let total = 0;
  for (const payment of payments) {
    const attributed = resolvePaymentTeacherId(payment, ctx);
    if (attributed === teacherMemberId) {
      total += payment.amount * (ratePercent / 100);
    }
  }
  return total;
}

export function settlementBalance(settlement: { amountAccrued: number; amountPaid: number }): number {
  return settlement.amountAccrued - settlement.amountPaid;
}
