import type { I18nKey } from "./i18n/keys";
import type { PaymentWithCorrectionMeta } from "./paymentCorrection";
import { paymentEffectiveAmount } from "./paymentCorrection";

export type DebtTraceEventKind =
  | "charge_created"
  | "payment"
  | "storno"
  | "billed_restated"
  | "write_off";

export interface PersonalLessonDebtTraceCharge {
  id: string;
  clientId?: string | null;
  clientDisplay: string;
  billedAmount: number;
  paidAmount: number;
  outstanding: number;
  createdAt?: string | null;
}

export interface PersonalLessonDebtTraceEvent {
  at: string;
  kind: DebtTraceEventKind;
  chargeId?: string | null;
  paymentId?: string | null;
  clientDisplay?: string | null;
  amount?: number | null;
  billedAmount?: number | null;
  oldBilled?: number | null;
  method?: string | null;
  correctionStatus?: string | null;
  reasonCode?: string | null;
  reasonComment?: string | null;
}

export interface PersonalLessonDebtTrace {
  lessonId: string;
  billedAmount: number;
  paidAmount: number;
  outstanding: number;
  mismatch: boolean;
  charges: PersonalLessonDebtTraceCharge[];
  events: PersonalLessonDebtTraceEvent[];
}

export function debtTraceMismatch(billedAmount: number, paidAmount: number, outstanding: number): boolean {
  return outstanding > 0.005 && paidAmount > 0.005 && billedAmount - paidAmount > 0.005;
}

/** Explain why billed − paid is still open after money was received. */
export function debtOriginHintKey(
  billedAmount: number,
  paidAmount: number,
  outstanding: number,
  payments: Pick<PaymentWithCorrectionMeta, "operationKind" | "replacesPaymentId" | "correctionStatus">[]
): Extract<
  I18nKey,
  | "finance.debtors.trace.hintCorrection"
  | "finance.debtors.trace.hintPartial"
  | "finance.debtors.trace.hintUnpaid"
> | null {
  if (outstanding <= 0.005) return null;
  const hasStornoOrReplace = payments.some(
    (payment) =>
      payment.operationKind === "storno" ||
      Boolean(payment.replacesPaymentId) ||
      payment.correctionStatus === "replaced" ||
      payment.correctionStatus === "voided"
  );
  if (hasStornoOrReplace && paidAmount > 0) return "finance.debtors.trace.hintCorrection";
  if (paidAmount > 0) return "finance.debtors.trace.hintPartial";
  return "finance.debtors.trace.hintUnpaid";
}

export function mapPersonalLessonDebtTrace(raw: Record<string, unknown>): PersonalLessonDebtTrace {
  const charges = Array.isArray(raw.charges)
    ? raw.charges.map((item) => mapTraceCharge(item as Record<string, unknown>))
    : [];
  const events = Array.isArray(raw.events)
    ? raw.events.map((item) => mapTraceEvent(item as Record<string, unknown>))
    : [];
  const billedAmount = Number(raw.billed_amount) || charges.reduce((sum, charge) => sum + charge.billedAmount, 0);
  const paidAmount = Number(raw.paid_amount) || charges.reduce((sum, charge) => sum + charge.paidAmount, 0);
  const outstanding =
    raw.outstanding != null
      ? Number(raw.outstanding) || 0
      : Math.max(billedAmount - paidAmount, 0);

  return {
    lessonId: String(raw.personal_lesson_id ?? raw.lesson_id ?? ""),
    billedAmount,
    paidAmount,
    outstanding,
    mismatch: raw.mismatch === true || debtTraceMismatch(billedAmount, paidAmount, outstanding),
    charges,
    events,
  };
}

function mapTraceCharge(row: Record<string, unknown>): PersonalLessonDebtTraceCharge {
  return {
    id: String(row.id ?? ""),
    clientId: row.client_id != null ? String(row.client_id) : null,
    clientDisplay: String(row.client_display ?? ""),
    billedAmount: Number(row.billed_amount) || 0,
    paidAmount: Number(row.paid_amount) || 0,
    outstanding: Number(row.outstanding) || 0,
    createdAt: row.created_at != null ? String(row.created_at) : null,
  };
}

function mapTraceEvent(row: Record<string, unknown>): PersonalLessonDebtTraceEvent {
  const kind = String(row.kind ?? "payment") as DebtTraceEventKind;
  return {
    at: String(row.at ?? ""),
    kind: ["charge_created", "payment", "storno", "billed_restated", "write_off"].includes(kind)
      ? kind
      : "payment",
    chargeId: row.charge_id != null ? String(row.charge_id) : null,
    paymentId: row.payment_id != null ? String(row.payment_id) : null,
    clientDisplay: row.client_display != null ? String(row.client_display) : null,
    amount: row.amount != null ? Number(row.amount) : null,
    billedAmount: row.billed_amount != null ? Number(row.billed_amount) : null,
    oldBilled: row.old_billed != null ? Number(row.old_billed) : null,
    method: row.method != null ? String(row.method) : null,
    correctionStatus: row.correction_status != null ? String(row.correction_status) : null,
    reasonCode: row.reason_code != null ? String(row.reason_code) : null,
    reasonComment: row.reason_comment != null ? String(row.reason_comment) : null,
  };
}

export function netPaidFromPayments(
  payments: Pick<PaymentWithCorrectionMeta, "amount" | "operationKind">[]
): number {
  return payments.reduce((sum, payment) => sum + paymentEffectiveAmount(payment), 0);
}
