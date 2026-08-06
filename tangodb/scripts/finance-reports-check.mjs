/**
 * Finance report formula checks (extended revenue, refunds, rental net, trend).
 * Run: node scripts/finance-reports-check.mjs
 */
import assert from "node:assert/strict";

function aggregateRentalMoneyRegisterStats(entries) {
  let total = 0;
  let grossInflow = 0;
  for (const entry of entries) {
    const amount = entry.signedAmount;
    if (amount === 0) continue;
    total += amount;
    if (amount > 0) grossInflow += amount;
  }
  return { total, grossInflow };
}

function aggregatePaymentStats(payments) {
  let total = 0;
  let subscriptionTotal = 0;
  for (const payment of payments) {
    const effective =
      payment.operationKind === "storno" ? -payment.amount : payment.amount;
    if (effective === 0) continue;
    total += effective;
    if (payment.subscriptionId) subscriptionTotal += effective;
  }
  return { total, subscriptionTotal };
}

function combineRevenueStats(payments, refunds) {
  const paymentStats = aggregatePaymentStats(payments);
  const completedTotal = refunds
    .filter((r) => r.status === "completed")
    .reduce((sum, r) => sum + r.amount, 0);
  return {
    ...paymentStats,
    subscriptionTotal: paymentStats.subscriptionTotal - completedTotal,
    netTotal: paymentStats.total - completedTotal,
  };
}

function buildExtendedRevenueStats(payments, refunds, options = {}) {
  const base = combineRevenueStats(payments, refunds);
  const other = options.otherIncomeAmount ?? 0;
  const rentalStats = aggregateRentalMoneyRegisterStats(options.rentalRegisterEntries ?? []);
  return {
    netTotal: base.netTotal + other + rentalStats.total,
    rentalNetTotal: rentalStats.total,
    rentalGross: rentalStats.grossInflow,
  };
}

const payments = [
  { amount: 1000, subscriptionId: "s1" },
  { amount: 500, subscriptionId: "s1", operationKind: "storno" },
  { amount: 300, personalLessonId: "p1" },
];

const refunds = [{ status: "completed", amount: 200 }];

const base = combineRevenueStats(payments, refunds);
assert.equal(base.total, 800, "payments net of storno");
assert.equal(base.subscriptionTotal, 300, "subscription minus refund allocation");
assert.equal(base.netTotal, 600, "net after completed refunds");

const rentalEntries = [
  { signedAmount: 3000 },
  { signedAmount: -200 },
];

const extended = buildExtendedRevenueStats(payments, refunds, {
  otherIncomeAmount: 100,
  rentalRegisterEntries: rentalEntries,
});

assert.equal(extended.rentalNetTotal, 2800, "rental net includes returns");
assert.equal(extended.netTotal, 600 + 100 + 2800, "extended net uses signed rental total");

console.log("finance-reports-check: OK");
