/**
 * Debt origin hint (950k billed / 800k paid leftover).
 * Run: node scripts/personal-debt-trace-check.mjs
 */
import assert from "node:assert/strict";

function debtTraceMismatch(billedAmount, paidAmount, outstanding) {
  return outstanding > 0.005 && paidAmount > 0.005 && billedAmount - paidAmount > 0.005;
}

function debtOriginHintKey(billedAmount, paidAmount, outstanding, payments) {
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

const billed = 950_000;
const paid = 800_000;
const debt = billed - paid;

assert.equal(debt, 150_000, "leftover is billed − paid");
assert.equal(debtTraceMismatch(billed, paid, debt), true, "950/800 is a billed mismatch");
assert.equal(
  debtOriginHintKey(billed, paid, debt, [{ operationKind: "storno" }]),
  "finance.debtors.trace.hintCorrection"
);
assert.equal(
  debtOriginHintKey(billed, paid, debt, [{ operationKind: "payment" }]),
  "finance.debtors.trace.hintPartial"
);
assert.equal(debtOriginHintKey(billed, 0, billed, []), "finance.debtors.trace.hintUnpaid");
assert.equal(debtOriginHintKey(800_000, 800_000, 0, []), null);

console.log("personal-debt-trace-check ok");
