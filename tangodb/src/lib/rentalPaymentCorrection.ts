import type { PaymentMethod } from "../types";
import {
  PAYMENT_CORRECTION_REASONS,
  type PaymentCorrectionReasonCode,
  type PaymentCorrectionStatus,
  type PaymentOperationKind,
} from "./paymentCorrection";

export type RentalPaymentWithCorrectionMeta = {
  id: string;
  rentalId: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  methodComment?: string | null;
  createdAt: string;
  createdBy?: string | null;
  operationKind?: PaymentOperationKind;
  reversesPaymentId?: string | null;
  replacesPaymentId?: string | null;
  correctionReasonCode?: string | null;
  correctionComment?: string | null;
  operationNumber?: number | null;
  correctionStatus?: PaymentCorrectionStatus;
  remainingAmount?: number;
  renterDisplay?: string;
};

export { PAYMENT_CORRECTION_REASONS, type PaymentCorrectionReasonCode };

export function rentalPaymentEffectiveAmount(payment: RentalPaymentWithCorrectionMeta): number {
  if (payment.operationKind === "storno") return -payment.amount;
  return payment.amount;
}

export function filterVisibleRentalCorrectionPayments(
  payments: RentalPaymentWithCorrectionMeta[]
): RentalPaymentWithCorrectionMeta[] {
  const voidedOriginalIds = new Set(
    payments
      .filter((p) => p.operationKind === "payment" && p.correctionStatus === "voided")
      .map((p) => p.id)
  );
  const replacedOriginalIds = new Set(
    payments
      .filter((p) => p.operationKind === "payment" && p.correctionStatus === "replaced")
      .map((p) => p.id)
  );

  return payments.filter((p) => {
    if (p.operationKind === "storno") return true;
    if (voidedOriginalIds.has(p.id) || replacedOriginalIds.has(p.id)) return false;
    return true;
  });
}

export function rentalPaymentCanCorrect(payment: RentalPaymentWithCorrectionMeta): boolean {
  return (
    payment.operationKind !== "storno" &&
    payment.correctionStatus !== "voided" &&
    payment.correctionStatus !== "replaced" &&
    (payment.remainingAmount ?? payment.amount) > 0
  );
}
