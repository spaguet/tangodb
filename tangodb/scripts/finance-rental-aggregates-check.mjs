/**
 * Stage 5: unified rental money register aggregates.
 * Run: node scripts/finance-rental-aggregates-check.mjs
 */
import assert from "node:assert/strict";

function aggregateRentalMoneyRegisterStats(entries) {
  const byMethod = {};
  let total = 0;
  let grossInflow = 0;
  let count = 0;
  for (const entry of entries) {
    const amount = entry.signedAmount;
    if (amount === 0) continue;
    total += amount;
    if (amount > 0) {
      grossInflow += amount;
      count += 1;
    }
    byMethod[entry.method] = (byMethod[entry.method] ?? 0) + amount;
  }
  return { total, grossInflow, count, byMethod };
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

const register = [
  { signedAmount: 3000, method: "cash", entryType: "direct_booking_payment" },
  { signedAmount: 1500, method: "transfer", entryType: "invoice_payment" },
  { signedAmount: 500, method: "card", entryType: "advance_received" },
  { signedAmount: -200, method: "other", entryType: "deposit_return" },
];

const clientStats = aggregatePaymentStats(client);
const rentalStats = aggregateRentalMoneyRegisterStats(register);
const merged = mergePaymentStatsWithRentals(clientStats, rentalStats);

assert.equal(clientStats.count, 2);
assert.equal(rentalStats.count, 3, "only positive inflows count as operations");
assert.equal(rentalStats.grossInflow, 5000);
assert.equal(rentalStats.total, 4800, "net includes deposit return");
assert.equal(merged.count, 5);
assert.equal(merged.byMethod.cash, 4000);
assert.equal(merged.byMethod.card, 1000);
assert.equal(merged.byMethod.transfer, 1500);
assert.equal(merged.byMethod.other, -200);

const keys = new Set(register.map((e, i) => `${e.entryType}:${i}`));
assert.equal(keys.size, register.length, "no duplicate register keys in fixture");

console.log("finance-rental-aggregates-check: OK");
