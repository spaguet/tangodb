/**
 * Lightweight regression for rental tariff archive filters (no Vitest).
 * Run: tsx scripts/rental-tariff-archive-check.mjs
 */
import assert from "node:assert/strict";
import {
  groupTariffsByLocation,
  resolveTariffStatusQueryFilter,
} from "../src/lib/rentalTariffPricing.ts";

assert.equal(resolveTariffStatusQueryFilter("all"), null);
assert.equal(resolveTariffStatusQueryFilter("active"), "active");
assert.equal(resolveTariffStatusQueryFilter("archived"), "archived");

const tariffs = [
  { id: "t1", name: "B Hall", tariffType: "fixed", locationId: "loc-b", status: "active", price: 100 },
  { id: "t2", name: "A All", tariffType: "fixed", locationId: null, status: "archived", price: 200 },
  { id: "t3", name: "A Hall", tariffType: "hourly", locationId: "loc-a", status: "active", price: 50 },
];

const locationMap = new Map([
  ["loc-a", "Alpha"],
  ["loc-b", "Beta"],
]);

const groups = groupTariffsByLocation(tariffs, locationMap);
assert.equal(groups.length, 3);
assert.equal(groups[0].locationKey, null);
assert.equal(groups[0].tariffs[0].id, "t2");
assert.equal(groups[1].tariffs[0].name, "A Hall");
assert.equal(groups[2].tariffs[0].name, "B Hall");

console.log("rental-tariff-archive-check: ok");
