import type { Payment, PaymentMethod } from "../types";

export type PaymentCorrectionStatus =
  | "active"
  | "voided"
  | "partially_voided"
  | "replaced"
  | "storno";

export type PaymentOperationKind = "payment" | "storno";

export const PAYMENT_CORRECTION_REASONS = [
  { code: "duplicate", labelKey: "corrections.payment.reason.duplicate" },
  { code: "wrong_amount", labelKey: "corrections.payment.reason.wrongAmount" },
  { code: "wrong_method", labelKey: "corrections.payment.reason.wrongMethod" },
  { code: "wrong_client", labelKey: "corrections.payment.reason.wrongClient" },
  { code: "other", labelKey: "corrections.payment.reason.other" },
] as const;

export type PaymentCorrectionReasonCode = (typeof PAYMENT_CORRECTION_REASONS)[number]["code"];

export const ATTENDANCE_CORRECTION_REASONS = [
  { code: "misclick", labelKey: "corrections.attendance.reason.misclick" },
  { code: "wrong_client", labelKey: "corrections.attendance.reason.wrongClient" },
  { code: "subscription_error", labelKey: "corrections.attendance.reason.subscriptionError" },
  { code: "other", labelKey: "corrections.attendance.reason.other" },
] as const;

export type AttendanceCorrectionReasonCode = (typeof ATTENDANCE_CORRECTION_REASONS)[number]["code"];

export const ATTENDANCE_UNDO_WINDOW_MS = 30_000;

export interface PaymentWithCorrectionMeta extends Payment {
  operationKind?: PaymentOperationKind;
  reversesPaymentId?: string | null;
  replacesPaymentId?: string | null;
  correctionReasonCode?: string | null;
  correctionComment?: string | null;
  operationNumber?: number | null;
  correctionStatus?: PaymentCorrectionStatus;
  remainingAmount?: number;
  stornoTotal?: number;
}

export interface AttendanceCorrectionRecord {
  id: string;
  subscriptionId: string;
  scheduleGroupId: string;
  occurrenceDate: string;
  clientDisplay: string;
  oldStatus: string | null;
  newStatus: string;
  reasonCode: string | null;
  reasonComment: string | null;
  isUndo: boolean;
  operationNumber: number | null;
  createdAt: string;
  authorName?: string | null;
}

export interface CorrectionReportPaymentRow {
  kind: "payment";
  id: string;
  operationNumber: number | null;
  operationKind: PaymentOperationKind;
  amount: number;
  method: PaymentMethod;
  clientDisplay: string;
  reasonCode: string | null;
  reasonComment: string | null;
  reversesPaymentId: string | null;
  replacesPaymentId: string | null;
  createdAt: string;
  authorName: string | null;
  relatedStatus: PaymentCorrectionStatus;
}

export interface CorrectionReportAttendanceRow {
  kind: "attendance";
  id: string;
  operationNumber: number | null;
  clientDisplay: string;
  oldStatus: string | null;
  newStatus: string;
  reasonCode: string | null;
  reasonComment: string | null;
  isUndo: boolean;
  occurrenceDate: string;
  createdAt: string;
  authorName: string | null;
}

/** Net revenue effect: payments minus storno rows. */
export function paymentEffectiveAmount(payment: Pick<PaymentWithCorrectionMeta, "amount" | "operationKind">): number {
  return payment.operationKind === "storno" ? -payment.amount : payment.amount;
}

export function aggregateEffectivePaymentTotal(
  payments: PaymentWithCorrectionMeta[]
): number {
  return payments.reduce((sum, p) => sum + paymentEffectiveAmount(p), 0);
}

export function paymentStatusLabelKey(status: PaymentCorrectionStatus): string {
  switch (status) {
    case "active":
      return "corrections.payment.status.active";
    case "voided":
      return "corrections.payment.status.voided";
    case "partially_voided":
      return "corrections.payment.status.partiallyVoided";
    case "replaced":
      return "corrections.payment.status.replaced";
    default:
      return "corrections.payment.status.storno";
  }
}

export function formatOperationNumber(num: number | null | undefined): string {
  if (num == null) return "—";
  return `#${num}`;
}
