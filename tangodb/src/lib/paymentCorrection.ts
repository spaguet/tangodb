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

/** Hide superseded originals — storno/replacement rows represent the correction event. */
export function filterVisibleCorrectionPayments(
  payments: CorrectionReportPaymentRow[]
): CorrectionReportPaymentRow[] {
  return payments.filter((row) => {
    if (row.operationKind !== "payment" || row.replacesPaymentId) return true;
    return row.relatedStatus !== "voided" && row.relatedStatus !== "replaced";
  });
}

export function paymentCorrectionActionLabelKey(row: CorrectionReportPaymentRow): string {
  if (row.operationKind === "storno") return "corrections.page.actionVoid";
  if (row.replacesPaymentId) return "corrections.page.actionReplacement";
  return "corrections.page.actionOriginal";
}

export function paymentCorrectionReasonLabelKey(code: string | null): string | null {
  if (!code) return null;
  const match = PAYMENT_CORRECTION_REASONS.find((reason) => reason.code === code);
  return match?.labelKey ?? null;
}

function str(value: unknown): string | null {
  if (value == null || value === "") return null;
  return String(value);
}

/** RPC `get_corrections_report` returns snake_case via row_to_json. */
export function mapCorrectionReportPaymentRow(
  row: Record<string, unknown>
): CorrectionReportPaymentRow {
  return {
    kind: "payment",
    id: String(row.id),
    operationNumber: row.operation_number != null ? Number(row.operation_number) : null,
    operationKind: (row.operation_kind as PaymentOperationKind) ?? "payment",
    amount: Number(row.amount) || 0,
    method: (row.method as PaymentMethod) ?? "cash",
    clientDisplay: String(row.client_display ?? ""),
    reasonCode: str(row.reason_code),
    reasonComment: str(row.reason_comment),
    reversesPaymentId: str(row.reverses_payment_id),
    replacesPaymentId: str(row.replaces_payment_id),
    createdAt: String(row.created_at ?? ""),
    authorName: str(row.author_name),
    relatedStatus: (row.related_status as PaymentCorrectionStatus) ?? "active",
  };
}

export function mapCorrectionReportAttendanceRow(
  row: Record<string, unknown>
): CorrectionReportAttendanceRow {
  return {
    kind: "attendance",
    id: String(row.id),
    operationNumber: row.operation_number != null ? Number(row.operation_number) : null,
    clientDisplay: String(row.client_display ?? ""),
    oldStatus: str(row.old_status),
    newStatus: String(row.new_status ?? ""),
    reasonCode: str(row.reason_code),
    reasonComment: str(row.reason_comment),
    isUndo: row.is_undo === true,
    occurrenceDate: String(row.occurrence_date ?? "").slice(0, 10),
    createdAt: String(row.created_at ?? ""),
    authorName: str(row.author_name),
  };
}
