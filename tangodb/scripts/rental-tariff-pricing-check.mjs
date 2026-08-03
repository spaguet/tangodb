/**
 * Lightweight regression for rental tariff pricing helpers (no Vitest).
 * Run: node scripts/rental-tariff-pricing-check.mjs
 */
import assert from "node:assert/strict";

function fixedTariffListPrice(tariff) {
  if (tariff.tariffType !== "fixed" || tariff.price == null) return null;
  return tariff.price;
}

function tariffMatchesLocation(tariff, locationId) {
  return !tariff.locationId || tariff.locationId === locationId;
}

function filterFixedTariffsForLocation(tariffs, locationId) {
  return tariffs.filter((tariff) => tariff.tariffType === "fixed" && tariffMatchesLocation(tariff, locationId));
}

function hasHourlyTariffsForLocation(tariffs, locationId) {
  return tariffs.some((tariff) => tariff.tariffType === "hourly" && tariffMatchesLocation(tariff, locationId));
}

function needsRentalAmountOverrideReason(tariffId, tariffPrice, enteredAmount) {
  if (!tariffId || tariffPrice == null) return false;
  return enteredAmount !== tariffPrice;
}

function formatTariffSelectLabel(tariff, formatAmount) {
  if (tariff.price == null) return tariff.name;
  return `${tariff.name} — ${formatAmount(tariff.price, tariff.currency)}`;
}

const loc = "loc-1";
const fixed = {
  id: "t1",
  name: "Fixed Hall",
  tariffType: "fixed",
  locationId: loc,
  price: 3000,
  currency: "RUB",
};
const hourly = { ...fixed, id: "t2", name: "Hourly", tariffType: "hourly", price: 500 };
const allLoc = { ...fixed, id: "t3", locationId: null };

assert.equal(fixedTariffListPrice(fixed), 3000);
assert.equal(fixedTariffListPrice(hourly), null);
assert.equal(filterFixedTariffsForLocation([fixed, hourly, allLoc], loc).length, 2);
assert.equal(hasHourlyTariffsForLocation([fixed, hourly], loc), true);
assert.equal(needsRentalAmountOverrideReason("t1", 3000, 2500), true);
assert.equal(
  formatTariffSelectLabel(fixed, (amount) => `${amount} RUB`),
  "Fixed Hall — 3000 RUB"
);

console.log("rental-tariff-pricing-check: ok");
