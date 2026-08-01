/**
 * Lightweight regression for venueCostRules preview/validation (no Vitest in repo).
 * Run: node scripts/venue-cost-rules-check.mjs
 */
import assert from "node:assert/strict";

function specificity(rule) {
  return Number(!!rule.teacherMemberId) + Number(!!rule.disciplineId) + Number(!!rule.locationId);
}

function previewGroupVenueCost(rules, attendees, disciplineId = null, locationId = null, teacherMemberId = null) {
  const matching = rules.group
    .filter(
      (rule) =>
        (!rule.teacherMemberId || rule.teacherMemberId === teacherMemberId) &&
        (!rule.disciplineId || rule.disciplineId === disciplineId) &&
        (!rule.locationId || rule.locationId === locationId)
    )
    .sort((a, b) => specificity(b) - specificity(a))[0];
  const tier = matching?.attendanceTiers.find(
    (item) => item.minAttendees <= attendees && (item.maxAttendees == null || item.maxAttendees >= attendees)
  );
  return tier?.amount ?? 0;
}

const tangoRules = {
  currency: "VND",
  group: [
    {
      teacherMemberId: "t1",
      disciplineId: "tango",
      locationId: null,
      attendanceTiers: [
        { minAttendees: 0, maxAttendees: 4, amount: 150_000 },
        { minAttendees: 5, maxAttendees: null, amount: 200_000 },
      ],
    },
    {
      teacherMemberId: "t2",
      disciplineId: "tango",
      locationId: null,
      attendanceTiers: [
        { minAttendees: 0, maxAttendees: null, amount: 50_000 },
      ],
    },
  ],
  personal: [],
};

assert.equal(previewGroupVenueCost(tangoRules, 0, "tango", null, "t1"), 150_000);
assert.equal(previewGroupVenueCost(tangoRules, 4, "tango", null, "t1"), 150_000);
assert.equal(previewGroupVenueCost(tangoRules, 5, "tango", null, "t1"), 200_000);
assert.equal(previewGroupVenueCost(tangoRules, 12, "tango", null, "t1"), 200_000);
assert.equal(previewGroupVenueCost(tangoRules, 5, "ballroom", null, "t1"), 0);
assert.equal(previewGroupVenueCost(tangoRules, 3, "tango", null, "t2"), 50_000);
assert.equal(previewGroupVenueCost(tangoRules, 3, "tango", null, "t3"), 0);

console.log("venue-cost-rules-check: ok");
