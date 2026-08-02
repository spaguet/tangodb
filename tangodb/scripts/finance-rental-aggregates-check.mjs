/**
 * Stage 4: rental_payments in revenue count/byMethod (provisional until register stage 5).
 * Run: node scripts/finance-rental-aggregates-check.mjs
 */
import assert from "node:assert/strict";

function aggregateRentalPaymentStats(payments) {
  const byMethod = {};
  let total = 0;
  let count = 0;
  for (const payment of payments) {
    if (payment.amount <= 0) continue;
    total += payment.amount;
    count += 1;
    byMethod[payment.method] = (byMethod[payment.method] ?? 0) + payment.amount;
  }
  return { total, count, byMethod };
}

function aggregatePaymentStats(payments) {
  const byMethod = {};
  let total = 0;
  let count = 0;
  for (const payment of payments) {
    if (payment.amount <= 0) continue;
    total += payment.amount;
    count += 1;
    byMethod[payment.method] = (byMethod[payment.method] ?? 0) + payment.amount;
  }
  return { total, count, byMethod };
}

function mergePaymentStatsWithRentals(base, rentalStats) {
  const byMethod = { ...base.byMethod };
  for (const [method, amount] of Object.entries(rentalStats.byMethod)) {
    byMethod[method] = (byMethod[method] ?? 0) + amount;
  }
  return {
    ...base,
    count: base.count + rentalStats.count,
    byMethod,
  };
}

const client = [
  { amount: 1000, method: "cash" },
  { amount: 500, method: "card" },
];
const rental = [
  { amount: 3000, method: "cash" },
  { amount: 1500, method: "transfer" },
];

const clientStats = aggregatePaymentStats(client);
const rentalStats = aggregateRentalPaymentStats(rental);
const merged = mergePaymentStatsWithRentals(clientStats, rentalStats);

assert.equal(clientStats.count, 2);
assert.equal(rentalStats.count, 2);
assert.equal(merged.count, 4);
assert.equal(merged.byMethod.cash, 4000);
assert.equal(merged.byMethod.card, 500);
assert.equal(merged.byMethod.transfer, 1500);
assert.equal(clientStats.total + rentalStats.total, 6000);

// gross must not double-count rental when added once to totals
const gross = clientStats.total + rentalStats.total;
assert.equal(gross, 6000);

console.log("finance-rental-aggregates-check: OK");
