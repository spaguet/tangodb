/**
 * Personal tariff pricing formulas (multiply-first, no IEEE price*(minutes/duration)).
 * Run: npm run test:personal-tariff-pricing
 */
import assert from "node:assert/strict";
import {
  billedFromTariff,
  durationParts,
  durationWarning,
  formatLessonDuration,
  lessonDurationMinutes,
  splitBilledEqually,
  tariffUnitsSnapshot,
} from "../src/lib/personalTariffPricing.ts";

const T45 = 45;
const T60 = 60;
const PRICE = 300;

assert.equal(billedFromTariff(PRICE, 45, T45), 300);
assert.equal(billedFromTariff(PRICE, 90, T45), 600);
assert.equal(billedFromTariff(PRICE, 60, T45), 400);
assert.equal(billedFromTariff(PRICE, 30, T45), 200);
assert.equal(billedFromTariff(PRICE, 90, T60), 450);
assert.equal(billedFromTariff(PRICE, 45, T60), 225);

const unitsSnapTrap = Math.round((60 / T45) * 10000) / 10000;
assert.equal(Math.round(PRICE * unitsSnapTrap * 100) / 100, 399.99, "price × units_snap must trap at 399.99");
assert.equal(billedFromTariff(PRICE, 60, T45), 400);

assert.equal(billedFromTariff(PRICE, 60, null), 300, "legacy tariff without duration");

assert.equal(durationWarning({ lessonMinutes: 45, tariffDurationMinutes: 45 }), null);
assert.equal(
  durationWarning({ lessonMinutes: 60, tariffDurationMinutes: 45 }),
  "longer_not_multiple"
);
assert.equal(
  durationWarning({ lessonMinutes: 90, tariffDurationMinutes: 45 }),
  "longer_multiple"
);
assert.equal(
  durationWarning({ lessonMinutes: 30, tariffDurationMinutes: 45 }),
  "shorter"
);
assert.equal(
  durationWarning({ lessonMinutes: 60, tariffDurationMinutes: null }),
  "legacy_no_duration"
);

assert.deepEqual(durationParts(45), { hours: 0, minutes: 45 });
assert.deepEqual(durationParts(60), { hours: 1, minutes: 0 });
assert.deepEqual(durationParts(90), { hours: 1, minutes: 30 });

const translate = (key, params = {}) => {
  if (key === "personalTariff.duration.hoursOnly") return `${params.hours}h`;
  if (key === "personalTariff.duration.minutesOnly") return `${params.minutes}m`;
  if (key === "personalTariff.duration.hoursAndMinutes") {
    return `${params.hours}h ${params.minutes}m`;
  }
  return key;
};

assert.equal(formatLessonDuration(45, translate), "45m");
assert.equal(formatLessonDuration(60, translate), "1h");
assert.equal(formatLessonDuration(90, translate), "1h 30m");

assert.equal(tariffUnitsSnapshot(60, 45), 1.3333);
assert.equal(tariffUnitsSnapshot(90, 45), 2);

assert.deepEqual(splitBilledEqually(600, 2), [300, 300]);
assert.deepEqual(splitBilledEqually(100, 3), [33.34, 33.33, 33.33]);

assert.equal(lessonDurationMinutes("19:00", "19:45"), 45);
assert.equal(lessonDurationMinutes("19:00", "20:30"), 90);
assert.ok(lessonDurationMinutes("19:00", "19:00") <= 0);

console.log("personal-tariff-pricing-check: ok");
