/**
 * Lightweight regression for rental effective amount / remaining / status (no Vitest).
 * Run: node scripts/rental-effective-amount-check.mjs
 */
import assert from "node:assert/strict";

function rentalEffectiveAmount(fixedAmount, finalAmount) {
  if (finalAmount != null) return finalAmount;
  if (fixedAmount != null) return fixedAmount;
  return 0;
}

function rentalRemainingAmount(effectiveAmount, paidAmount) {
  return Math.max(0, (effectiveAmount ?? 0) - (paidAmount ?? 0));
}

function rentalPaymentStatus(effectiveAmount, paidAmount) {
  const total = effectiveAmount ?? 0;
  const paid = paidAmount ?? 0;
  if (paid <= 0) return "unpaid";
  if (total > 0 && paid > total) return "overpaid";
  if (total > 0 && paid >= total) return "paid";
  if (total <= 0 && paid > 0) return "overpaid";
  return "partial";
}

// fixed only
assert.equal(rentalEffectiveAmount(3000, null), 3000);
assert.equal(rentalEffectiveAmount(3000, undefined), 3000);
assert.equal(rentalEffectiveAmount(null, null), 0);

// final overrides fixed (manual adjustment / series correction)
assert.equal(rentalEffectiveAmount(3000, 2500), 2500);
assert.equal(rentalEffectiveAmount(0, 1800), 1800);

// remaining
assert.equal(rentalRemainingAmount(2500, 1000), 1500);
assert.equal(rentalRemainingAmount(2500, 2500), 0);
assert.equal(rentalRemainingAmount(2500, 3000), 0);

// status
assert.equal(rentalPaymentStatus(2500, 0), "unpaid");
assert.equal(rentalPaymentStatus(2500, 1000), "partial");
assert.equal(rentalPaymentStatus(2500, 2500), "paid");
assert.equal(rentalPaymentStatus(2500, 2700), "overpaid");
assert.equal(rentalPaymentStatus(0, 500), "overpaid");

// hourly-style: calculated 4200, final null → effective = fixed
assert.equal(rentalEffectiveAmount(4200, null), 4200);
assert.equal(rentalPaymentStatus(4200, 2100), "partial");
assert.equal(rentalRemainingAmount(4200, 2100), 2100);

// series correction lowers total below paid → overpaid
assert.equal(rentalEffectiveAmount(5000, 3000), 3000);
assert.equal(rentalPaymentStatus(3000, 4000), "overpaid");

console.log("rental-effective-amount-check: ok");
