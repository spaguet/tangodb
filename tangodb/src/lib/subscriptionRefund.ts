import type { BillingModel } from "../types";

export type RefundCalcMode = "pro_rata" | "single_visit_rate";

export interface SubscriptionRefundFormula {
  billingModel: BillingModel;
  requiresManualAmount: boolean;
  salePrice: number;
  receivedTotal: number;
  priorRefunds: number;
  pendingRefunds?: number;
  availableAmount: number;
  recommendedAmount?: number;
  lessonsTotal?: number;
  lessonsLeft?: number;
  lessonsUsed?: number;
  perLessonPrice?: number;
  formula?: string;
  expiresAt?: string | null;
  activationDate?: string;
  calcMode?: RefundCalcMode;
  singleVisitRate?: number;
  singleVisitTariffId?: string | null;
  retainedAmount?: number;
  amountOverride?: boolean;
}

export interface SubscriptionRefundParticipant {
  clientId: string;
  displayName: string;
}

export interface SubscriptionRefundPreview {
  subscriptionId: string;
  status: string;
  billingModel: BillingModel;
  activationDate: string;
  expiresAt?: string | null;
  lessonsTotal: number;
  lessonsLeft: number;
  participants: SubscriptionRefundParticipant[];
  formula: SubscriptionRefundFormula;
}

export interface SubscriptionRefundRecord {
  id: string;
  subscriptionId: string;
  clientId: string;
  amount: number;
  recommendedAmount?: number | null;
  method: "cash" | "transfer" | "card" | "other";
  status: "pending" | "completed" | "cancelled";
  refundKind: "partial" | "finish";
  lessonsDeducted: number;
  reason: string;
  operationDate: string;
  completedAt?: string | null;
  createdAt: string;
}

export function mapRefundFormula(raw: Record<string, unknown>): SubscriptionRefundFormula {
  return {
    billingModel: (raw.billingModel as BillingModel) || "lesson_count",
    requiresManualAmount: raw.requiresManualAmount === true,
    salePrice: Number(raw.salePrice) || 0,
    receivedTotal: Number(raw.receivedTotal) || 0,
    priorRefunds: Number(raw.priorRefunds) || 0,
    pendingRefunds: raw.pendingRefunds != null ? Number(raw.pendingRefunds) : undefined,
    availableAmount: Number(raw.availableAmount) || 0,
    recommendedAmount:
      raw.recommendedAmount != null ? Number(raw.recommendedAmount) : undefined,
    lessonsTotal: raw.lessonsTotal != null ? Number(raw.lessonsTotal) : undefined,
    lessonsLeft: raw.lessonsLeft != null ? Number(raw.lessonsLeft) : undefined,
    lessonsUsed: raw.lessonsUsed != null ? Number(raw.lessonsUsed) : undefined,
    perLessonPrice: raw.perLessonPrice != null ? Number(raw.perLessonPrice) : undefined,
    formula: raw.formula != null ? String(raw.formula) : undefined,
    expiresAt: raw.expiresAt != null ? String(raw.expiresAt).slice(0, 10) : null,
    activationDate:
      raw.activationDate != null ? String(raw.activationDate).slice(0, 10) : undefined,
    calcMode:
      raw.calcMode === "single_visit_rate" || raw.calcMode === "pro_rata"
        ? raw.calcMode
        : undefined,
    singleVisitRate:
      raw.singleVisitRate != null ? Number(raw.singleVisitRate) : undefined,
    singleVisitTariffId:
      raw.singleVisitTariffId != null ? String(raw.singleVisitTariffId) : null,
    retainedAmount: raw.retainedAmount != null ? Number(raw.retainedAmount) : undefined,
    amountOverride: raw.amountOverride === true,
  };
}

export function mapRefundPreview(raw: Record<string, unknown>): SubscriptionRefundPreview {
  const formulaRaw = (raw.formula as Record<string, unknown>) ?? {};
  return {
    subscriptionId: String(raw.subscriptionId),
    status: String(raw.status ?? ""),
    billingModel: (raw.billingModel as BillingModel) || "lesson_count",
    activationDate: String(raw.activationDate ?? "").slice(0, 10),
    expiresAt: raw.expiresAt != null ? String(raw.expiresAt).slice(0, 10) : null,
    lessonsTotal: Number(raw.lessonsTotal) || 0,
    lessonsLeft: Number(raw.lessonsLeft) || 0,
    participants: ((raw.participants as unknown[]) ?? []).map((row) => {
      const p = row as Record<string, unknown>;
      return {
        clientId: String(p.clientId),
        displayName: String(p.displayName ?? ""),
      };
    }),
    formula: mapRefundFormula(formulaRaw),
  };
}

export function mapSubscriptionRefund(row: Record<string, unknown>): SubscriptionRefundRecord {
  return {
    id: row.id as string,
    subscriptionId: row.subscription_id as string,
    clientId: row.client_id as string,
    amount: Number(row.amount) || 0,
    recommendedAmount:
      row.recommended_amount != null ? Number(row.recommended_amount) : null,
    method: (row.method as SubscriptionRefundRecord["method"]) || "cash",
    status: (row.status as SubscriptionRefundRecord["status"]) || "completed",
    refundKind: (row.refund_kind as SubscriptionRefundRecord["refundKind"]) || "finish",
    lessonsDeducted: Number(row.lessons_deducted) || 0,
    reason: String(row.reason ?? ""),
    operationDate: String(row.operation_date ?? "").slice(0, 10),
    completedAt: row.completed_at != null ? String(row.completed_at) : null,
    createdAt: String(row.created_at ?? ""),
  };
}

/** Client-side mirror of server recommended refund (preview only). */
export function previewRecommendedRefund(
  salePrice: number,
  lessonsTotal: number,
  lessonsLeft: number,
  availableAmount: number
): number {
  if (lessonsTotal <= 0 || lessonsLeft <= 0 || availableAmount <= 0) return 0;
  const recommended = Math.round(((salePrice * lessonsLeft) / lessonsTotal) * 100) / 100;
  return Math.min(recommended, availableAmount);
}

/**
 * Refund = sale − used lessons × single-visit tariff (capped by available).
 * Example: 1_600_000 package, 1 used @ 250_000 → refund 1_350_000.
 */
export function previewRefundBySingleVisitRate(
  salePrice: number,
  lessonsTotal: number,
  lessonsLeft: number,
  singleVisitRate: number,
  availableAmount: number
): { refundAmount: number; lessonsUsed: number; retainedAmount: number } {
  const lessonsUsed = Math.max(0, lessonsTotal - lessonsLeft);
  if (availableAmount <= 0 || !Number.isFinite(singleVisitRate) || singleVisitRate < 0) {
    return { refundAmount: 0, lessonsUsed, retainedAmount: 0 };
  }
  const retainedAmount = Math.round(lessonsUsed * singleVisitRate * 100) / 100;
  const raw = Math.max(0, Math.round((salePrice - retainedAmount) * 100) / 100);
  return {
    refundAmount: Math.min(raw, availableAmount),
    lessonsUsed,
    retainedAmount,
  };
}

export function computeLessonsFromRefundAmount(
  amount: number,
  perLessonPrice: number,
  lessonsLeft: number
): number {
  if (perLessonPrice <= 0 || amount <= 0 || lessonsLeft <= 0) return 0;
  return Math.min(lessonsLeft, Math.floor(amount / perLessonPrice));
}

export function isRefundAmountValid(amount: number, availableAmount: number): boolean {
  return amount >= 0 && amount <= availableAmount + 0.0001;
}

export function isPartialRefundAmountValid(amount: number, availableAmount: number): boolean {
  return amount > 0 && amount <= availableAmount + 0.0001;
}
