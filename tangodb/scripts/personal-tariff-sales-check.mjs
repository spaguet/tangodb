/**
 * Personal tariff sales aggregation (§5.3 S19).
 * Run: npm run test:personal-tariff-sales
 */
import assert from "node:assert/strict";
import {
  aggregatePersonalTariffSales,
  personalTariffSalesRowKey,
  PERSONAL_TARIFF_SALES_NO_TARIFF_KEY,
} from "../src/lib/personalTariffSales.ts";

const T45_ID = "price-t45";
const t45Snap = {
  priceId: T45_ID,
  tariffLabel: "T45",
  tariffPrice: 300,
  tariffDurationMinutes: 45,
};

function pay(amount, extra = {}) {
  return {
    personalLessonId: "lesson-1",
    amount,
    operationKind: "payment",
    ...extra,
  };
}

function storno(amount, extra = {}) {
  return {
    personalLessonId: "lesson-1",
    amount,
    operationKind: "storno",
    ...extra,
  };
}

// S19 acceptance: 3× T45 (600+300+300), 1 no-tariff 500, 1 storno T45 −300
const s19Payments = [
  pay(600, t45Snap),
  pay(300, t45Snap),
  pay(300, t45Snap),
  pay(500, { priceId: null, tariffLabel: null, tariffPrice: null, tariffDurationMinutes: null }),
  storno(300, t45Snap),
];

const s19Rows = aggregatePersonalTariffSales(s19Payments);
assert.equal(s19Rows.length, 2, "S19: two tariff rows");

const t45Row = s19Rows.find((r) => r.rowKey === `pid:${T45_ID}`);
const noTariffRow = s19Rows.find((r) => r.rowKey === PERSONAL_TARIFF_SALES_NO_TARIFF_KEY);

assert.ok(t45Row, "S19: T45 row present");
assert.equal(t45Row.countPaymentsNet, 2, "S19: T45 count 3−1");
assert.equal(t45Row.sumNet, 900, "S19: T45 sum 600+300+300−300");

assert.ok(noTariffRow, "S19: no-tariff row present");
assert.equal(noTariffRow.countPaymentsNet, 1, "S19: no-tariff count");
assert.equal(noTariffRow.sumNet, 500, "S19: no-tariff sum");

// After DELETE price: price_id NULL, snapshot key preserves tariff row
assert.equal(
  personalTariffSalesRowKey({
    priceId: null,
    tariffLabel: "T45",
    tariffPrice: 300,
    tariffDurationMinutes: 45,
  }),
  "snap:T45|300|45"
);

assert.equal(
  personalTariffSalesRowKey({
    priceId: T45_ID,
    tariffLabel: "T45",
    tariffPrice: 300,
    tariffDurationMinutes: 45,
  }),
  `pid:${T45_ID}`
);

// Subscription / single visit excluded
const mixed = aggregatePersonalTariffSales([
  pay(100, t45Snap),
  { ...pay(200), personalLessonId: null, subscriptionId: "sub-1" },
  { ...pay(50), personalLessonId: null, singleVisitId: "sv-1" },
]);
assert.equal(mixed.length, 1);
assert.equal(mixed[0].sumNet, 100);

// Top-up: two payments same lesson, units not aggregated (only payment count)
const topUp = aggregatePersonalTariffSales([
  pay(400, { ...t45Snap, tariffUnits: 2 }),
  pay(200, { ...t45Snap, tariffUnits: 2 }),
]);
assert.equal(topUp[0].countPaymentsNet, 2);
assert.equal(topUp[0].sumNet, 600);

console.log("personal-tariff-sales-check: OK");
