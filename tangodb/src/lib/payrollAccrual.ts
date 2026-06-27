import {
  buildClassTeacherMap,
  resolvePaymentTeacherId,
  type TeacherRevenueContext,
} from "./financeReports";
import type { Payment } from "../types";
import type { TeacherPayRate } from "../types/payroll";

export { resolvePaymentTeacherId, buildClassTeacherMap, type TeacherRevenueContext };

export interface TeacherAccrualBreakdown {
  fixedAmount: number;
  groupPercentAmount: number;
  personalPercentAmount: number;
  singleVisitPercentAmount: number;
  total: number;
}

/** Client-side breakdown mirroring `recalculate_teacher_settlement` logic. */
export function computeTeacherAccrualBreakdown(
  payments: Payment[],
  memberId: string,
  rate: TeacherPayRate | undefined,
  ctx: TeacherRevenueContext
): TeacherAccrualBreakdown {
  if (!rate) {
    return {
      fixedAmount: 0,
      groupPercentAmount: 0,
      personalPercentAmount: 0,
      singleVisitPercentAmount: 0,
      total: 0,
    };
  }

  const fixedAmount =
    rate.payMode === "fixed" || rate.payMode === "fixed_plus_percent" ? rate.fixedAmount : 0;

  let groupPercentAmount = 0;
  let personalPercentAmount = 0;
  let singleVisitPercentAmount = 0;

  if (rate.payMode === "percent" || rate.payMode === "fixed_plus_percent") {
    for (const payment of payments) {
      if (resolvePaymentTeacherId(payment, ctx) !== memberId) continue;
      if (payment.personalLessonId) {
        personalPercentAmount += payment.amount * (rate.personalRatePercent / 100);
      } else if (payment.singleVisitId) {
        singleVisitPercentAmount += payment.amount * (rate.singleVisitRatePercent / 100);
      } else if (payment.subscriptionId) {
        groupPercentAmount += payment.amount * (rate.groupRatePercent / 100);
      }
    }
  }

  return {
    fixedAmount,
    groupPercentAmount,
    personalPercentAmount,
    singleVisitPercentAmount,
    total: fixedAmount + groupPercentAmount + personalPercentAmount + singleVisitPercentAmount,
  };
}

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
