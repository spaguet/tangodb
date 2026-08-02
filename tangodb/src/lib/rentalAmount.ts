import type { RentalPaymentStatus } from "../types";

/** Mirrors SQL `_rental_effective_amount(fixed, final)`. */
export function rentalEffectiveAmount(
  fixedAmount: number | null | undefined,
  finalAmount?: number | null | undefined
): number {
  if (finalAmount != null) return finalAmount;
  if (fixedAmount != null) return fixedAmount;
  return 0;
}

/** Remaining debt (never negative). */
export function rentalRemainingAmount(
  effectiveAmount: number | null | undefined,
  paidAmount: number | null | undefined
): number {
  return Math.max(0, (effectiveAmount ?? 0) - (paidAmount ?? 0));
}

/** Mirrors SQL `_rental_payment_status` when passed the effective total. */
export function rentalPaymentStatus(
  effectiveAmount: number | null | undefined,
  paidAmount: number | null | undefined
): RentalPaymentStatus {
  const total = effectiveAmount ?? 0;
  const paid = paidAmount ?? 0;

  if (paid <= 0) return "unpaid";
  if (total > 0 && paid > total) return "overpaid";
  if (total > 0 && paid >= total) return "paid";
  if (total <= 0 && paid > 0) return "overpaid";
  return "partial";
}
