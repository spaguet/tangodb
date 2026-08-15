/**
 * Regression: finished subscription with attendance on date stays in attendance journal.
 * Mirrors filter logic in src/lib/attendanceSubs.ts (no Supabase import chain).
 * Run: node scripts/attendance-subs-for-date-check.mjs
 */
import assert from "node:assert/strict";

function subscriptionIsActiveForDate(sub, dateStr) {
  if (sub.status !== "active" || sub.activationDate > dateStr) return false;
  if (sub.billingModel === "monthly_unlimited") {
    return Boolean(sub.expiresAt && sub.expiresAt >= dateStr);
  }
  return sub.lessonsLeft > 0;
}

function subscriptionHasAttendanceOnDate(subId, dateStr, attendance, scheduleGroupId) {
  return attendance.some(
    (record) =>
      record.date === dateStr &&
      record.subscriptionId === subId &&
      (!scheduleGroupId || record.scheduleGroupId === scheduleGroupId)
  );
}

function isSubscriptionListedForAttendanceDate(sub, dateStr, attendance, scheduleGroupId) {
  const hasAttendanceOnDate = subscriptionHasAttendanceOnDate(
    sub.id,
    dateStr,
    attendance,
    scheduleGroupId
  );
  return subscriptionIsActiveForDate(sub, dateStr) || hasAttendanceOnDate;
}

const dateStr = "2026-08-15";
const subId = "sub-finished-last-lesson";
const scheduleGroupId = "group-1";

const baseSub = {
  id: subId,
  lessonsLeft: 0,
  activationDate: "2026-08-01",
  status: "finished",
  billingModel: "lesson_count",
  expiresAt: null,
};

const attendance = [
  {
    date: dateStr,
    subscriptionId: subId,
    scheduleGroupId,
    attendanceStatus: "present",
  },
];

assert.equal(
  isSubscriptionListedForAttendanceDate(baseSub, dateStr, attendance, scheduleGroupId),
  true,
  "finished sub with present mark must stay in journal"
);

assert.equal(
  isSubscriptionListedForAttendanceDate(baseSub, dateStr, [], scheduleGroupId),
  false,
  "finished sub without attendance must stay hidden"
);

assert.equal(
  isSubscriptionListedForAttendanceDate(
    { ...baseSub, status: "active", lessonsLeft: 1 },
    dateStr,
    [],
    scheduleGroupId
  ),
  true,
  "active sub with one lesson left must be listed"
);

console.log("attendance-subs-for-date-check: ok");
