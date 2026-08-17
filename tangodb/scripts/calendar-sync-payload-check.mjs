/**
 * Google Calendar event payload helpers smoke test.
 * Run: node scripts/calendar-sync-payload-check.mjs
 */
import assert from "node:assert/strict";

function buildPersonalLessonSummary(clientLabels, disciplineName) {
  const clients = clientLabels.length > 0 ? clientLabels.join(", ") : "Клиент";
  const discipline = (disciplineName ?? "").trim();
  if (discipline) return `${clients} · ${discipline}`;
  return clients;
}

assert.equal(
  buildPersonalLessonSummary(["Богдан"], "Бальные танцы"),
  "Богдан · Бальные танцы"
);
assert.equal(buildPersonalLessonSummary(["Богдан", "Мария"], "Танго"), "Богдан, Мария · Танго");
assert.equal(buildPersonalLessonSummary([], "Танго"), "Клиент · Танго");
assert.equal(buildPersonalLessonSummary(["Богдан"], null), "Богдан");

console.log("calendar-sync-payload-check: ok");
