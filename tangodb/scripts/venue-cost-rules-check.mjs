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

function isVenueCostPreviewScopeReady(scope) {
  return !!scope.teacherMemberId;
}

function defaultGroupPreviewScope(rules) {
  const rule = rules.group.find((item) => item.teacherMemberId) ?? rules.group[0];
  if (!rule) {
    return { teacherMemberId: null, disciplineId: null, locationId: null };
  }
  return {
    teacherMemberId: rule.teacherMemberId,
    disciplineId: rule.disciplineId,
    locationId: rule.locationId,
  };
}

function computeGroupPreviewPair(rules, scope) {
  if (!isVenueCostPreviewScopeReady(scope)) return null;
  return {
    four: previewGroupVenueCost(rules, 4, scope.disciplineId, scope.locationId, scope.teacherMemberId),
    five: previewGroupVenueCost(rules, 5, scope.disciplineId, scope.locationId, scope.teacherMemberId),
  };
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

// Without teacher scope — raw preview is 0, but UI must not show it as a real calculation.
assert.equal(previewGroupVenueCost(tangoRules, 4, null, null, null), 0);
assert.equal(computeGroupPreviewPair(tangoRules, { teacherMemberId: null, disciplineId: null, locationId: null }), null);
assert.equal(
  computeGroupPreviewPair(tangoRules, { teacherMemberId: "t1", disciplineId: "tango", locationId: null })?.four,
  150_000
);
assert.equal(
  computeGroupPreviewPair(tangoRules, { teacherMemberId: "t1", disciplineId: "tango", locationId: null })?.five,
  200_000
);

// Scope mismatch — real zero, not missing context.
assert.equal(
  computeGroupPreviewPair(tangoRules, { teacherMemberId: "t1", disciplineId: "ballroom", locationId: null })?.four,
  0
);

// Open-ended upper tier.
const openTierRules = {
  currency: "RUB",
  group: [
    {
      teacherMemberId: "t1",
      disciplineId: null,
      locationId: null,
      attendanceTiers: [
        { minAttendees: 0, maxAttendees: 3, amount: 100 },
        { minAttendees: 4, maxAttendees: null, amount: 150 },
      ],
    },
  ],
  personal: [],
};
assert.equal(previewGroupVenueCost(openTierRules, 4, null, null, "t1"), 150);
assert.equal(previewGroupVenueCost(openTierRules, 5, null, null, "t1"), 150);
assert.deepEqual(defaultGroupPreviewScope(tangoRules), {
  teacherMemberId: "t1",
  disciplineId: "tango",
  locationId: null,
});

console.log("venue-cost-rules-check: ok");
