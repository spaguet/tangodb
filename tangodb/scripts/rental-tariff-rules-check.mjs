/**
 * Lightweight regression for rental tariff preferential rule validation (no Vitest).
 * Run: tsx scripts/rental-tariff-rules-check.mjs
 */
import assert from "node:assert/strict";
import {
  findAmbiguousTariffRuleOverlaps,
  formatTariffRulePeriod,
  isTariffRuleDateRangeValid,
  nextTariffRulePriority,
  sortTariffRulesByApplicationOrder,
  tariffRuleDateRangesOverlap,
  validateRentalTariffRules,
} from "../src/lib/rentalTariffRules.ts";

const baseRule = {
  priority: 0,
  daysOfWeek: [1, 2, 3, 4, 5],
  timeStart: "18:00",
  timeEnd: "22:00",
  priceOverride: 500,
  validFrom: null,
  validTo: null,
};

// Date ranges — open boundaries overlap
assert.equal(tariffRuleDateRangesOverlap(null, null, null, null), true);
assert.equal(tariffRuleDateRangesOverlap("2026-01-01", "2026-03-31", "2026-04-01", "2026-06-30"), false);
assert.equal(tariffRuleDateRangesOverlap("2026-01-01", null, "2025-06-01", "2025-12-31"), false);
assert.equal(tariffRuleDateRangesOverlap("2026-01-01", null, "2026-06-01", null), true);

// Equal priority overlap — same days + time
const overlapping = [
  { ...baseRule, priority: 5 },
  { ...baseRule, priority: 5, timeStart: "20:00", timeEnd: "23:00" },
];
assert.equal(findAmbiguousTariffRuleOverlaps(overlapping).length, 1);

// Different priority — no ambiguous overlap
const resolved = [
  { ...baseRule, priority: 10 },
  { ...baseRule, priority: 5, timeStart: "20:00", timeEnd: "23:00" },
];
assert.equal(findAmbiguousTariffRuleOverlaps(resolved).length, 0);

// Non-overlapping dates with equal priority — allowed
const seasonal = [
  { ...baseRule, priority: 0, validFrom: "2026-01-01", validTo: "2026-03-31" },
  { ...baseRule, priority: 0, validFrom: "2026-04-01", validTo: "2026-12-31" },
];
assert.equal(findAmbiguousTariffRuleOverlaps(seasonal).length, 0);

// Past vs future rule with equal priority — allowed when dates don't overlap
const pastFuture = [
  { ...baseRule, priority: 1, validFrom: null, validTo: "2025-12-31" },
  { ...baseRule, priority: 1, validFrom: "2026-01-01", validTo: null },
];
assert.equal(findAmbiguousTariffRuleOverlaps(pastFuture).length, 0);

// Application order — higher priority first
const ordered = sortTariffRulesByApplicationOrder([
  { rule: { ...baseRule, priority: 1 }, index: 0 },
  { rule: { ...baseRule, priority: 10 }, index: 1 },
  { rule: { ...baseRule, priority: 5 }, index: 2 },
]);
assert.deepEqual(
  ordered.map((entry) => entry.index),
  [1, 2, 0]
);

assert.equal(nextTariffRulePriority([{ ...baseRule, priority: 3 }, { ...baseRule, priority: 7 }]), 8);

assert.equal(isTariffRuleDateRangeValid({ ...baseRule, validFrom: "2026-06-01", validTo: "2026-05-01" }), false);
assert.equal(validateRentalTariffRules(overlapping).some((issue) => issue.code === "ambiguousOverlap"), true);
assert.equal(validateRentalTariffRules([{ ...baseRule, daysOfWeek: [] }]).some((issue) => issue.code === "daysRequired"), true);

const t = (key, params) => {
  if (key === "rentalTariffs.rulePeriodOpen") return "open";
  if (key === "rentalTariffs.rulePeriodRange") return `${params.from} — ${params.to}`;
  return key;
};
assert.equal(formatTariffRulePeriod(baseRule, t), "open");
assert.equal(
  formatTariffRulePeriod({ ...baseRule, validFrom: "2026-12-20", validTo: "2027-01-10" }, t),
  "2026-12-20 — 2027-01-10"
);

console.log("rental-tariff-rules-check: ok");
