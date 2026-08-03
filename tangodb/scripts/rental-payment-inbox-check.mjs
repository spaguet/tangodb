/**
 * Rental payment inbox helpers (stage 22).
 * Run: node scripts/rental-payment-inbox-check.mjs
 */
import assert from "node:assert/strict";

function inboxItemToRentalLesson(item) {
  return {
    kind: "rental",
    rentalId: item.rentalId,
    date: item.rentalDate,
    timeStart: item.timeStart,
    timeEnd: item.timeEnd,
    locationId: item.locationId,
    rentalSeriesId: item.rentalSeriesId,
    bookingStatus: "confirmed",
    purpose: item.purpose,
    renterName: item.renterName,
    paymentStatus: item.paymentStatus,
    fixedAmount: item.effectiveAmount,
    paidAmount: item.paidAmount,
    currency: item.currency,
  };
}

const sample = {
  rentalId: "r1",
  rentalDate: "2026-08-03",
  timeStart: "10:00",
  timeEnd: "12:00",
  locationId: "loc1",
  rentalSeriesId: null,
  purpose: "Rehearsal",
  renterName: "Studio A",
  paymentStatus: "partial",
  effectiveAmount: 3000,
  paidAmount: 1000,
  currency: "RUB",
};

const lesson = inboxItemToRentalLesson(sample);
assert.equal(lesson.kind, "rental");
assert.equal(lesson.fixedAmount, 3000);
assert.equal(lesson.paidAmount, 1000);
assert.equal(lesson.paymentStatus, "partial");
assert.equal(lesson.date, "2026-08-03");

console.log("rental-payment-inbox-check: ok");
