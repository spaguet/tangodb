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

function scopeKey(prefix, teacherMemberId, disciplineId, locationId) {
  return `${prefix}:${teacherMemberId ?? "*"}:${disciplineId ?? "*"}:${locationId ?? "*"}`;
}

function diffPerLessonRules(draft, active, entries) {
  const draftGroup = new Map(
    draft.group.map((rule) => [
      scopeKey("group", rule.teacherMemberId, rule.disciplineId, rule.locationId),
      rule,
    ])
  );
  const activeGroup = new Map(
    active.group.map((rule) => [
      scopeKey("group", rule.teacherMemberId, rule.disciplineId, rule.locationId),
      rule,
    ])
  );
  for (const [key, rule] of draftGroup) {
    const baseline = activeGroup.get(key);
    if (!baseline) {
      entries.push({ kind: "added", section: "group", key });
      continue;
    }
    if (JSON.stringify(rule.attendanceTiers) !== JSON.stringify(baseline.attendanceTiers)) {
      entries.push({ kind: "changed", section: "group", key });
    }
  }
  for (const key of activeGroup.keys()) {
    if (!draftGroup.has(key)) entries.push({ kind: "removed", section: "group", key });
  }
}

function diffVenueCostVersions(draft, active) {
  const entries = [];
  if (!active) return entries;
  if (draft.mode !== active.mode) {
    entries.push({ kind: "changed", section: "meta", key: "mode" });
    return entries;
  }
  if (draft.mode === "per_lesson") {
    diffPerLessonRules(draft.rules, active.rules, entries);
  }
  return entries;
}

const activeSnapshot = {
  mode: "per_lesson",
  rules: tangoRules,
};
const draftWithTierChange = {
  mode: "per_lesson",
  rules: {
    ...tangoRules,
    group: tangoRules.group.map((rule, index) =>
      index === 0
        ? {
            ...rule,
            attendanceTiers: [
              { minAttendees: 0, maxAttendees: 4, amount: 160_000 },
              { minAttendees: 5, maxAttendees: null, amount: 200_000 },
            ],
          }
        : rule
    ),
  },
};
const draftDiff = diffVenueCostVersions(draftWithTierChange, activeSnapshot);
assert.ok(draftDiff.some((entry) => entry.kind === "changed" && entry.section === "group"));

const draftWithNewTeacher = {
  mode: "per_lesson",
  rules: {
    ...tangoRules,
    group: [
      ...tangoRules.group,
      {
        teacherMemberId: "t9",
        disciplineId: null,
        locationId: null,
        attendanceTiers: [{ minAttendees: 0, maxAttendees: null, amount: 99 }],
      },
    ],
  },
};
const addDiff = diffVenueCostVersions(draftWithNewTeacher, activeSnapshot);
assert.ok(addDiff.some((entry) => entry.kind === "added" && entry.key.includes("t9")));

function isVenueCostFixedPerLocation(rules) {
  return (rules.locations?.length ?? 0) > 0;
}

function buildFixedLocationAmounts(locations, existing) {
  const byId = new Map((existing ?? []).map((row) => [row.locationId, row.amount]));
  return locations.map((loc) => ({
    locationId: loc.id,
    amount: byId.get(loc.id) ?? 0,
  }));
}

const hallLocs = [{ id: "loc-a" }, { id: "loc-b" }];
const builtAmounts = buildFixedLocationAmounts(hallLocs, [{ locationId: "loc-a", amount: 12000 }]);
assert.equal(builtAmounts.length, 2);
assert.equal(builtAmounts[0].amount, 12000);
assert.equal(builtAmounts[1].amount, 0);
assert.equal(
  isVenueCostFixedPerLocation({ currency: "RUB", period: "month", amount: 0, locations: [{ locationId: "loc-a", amount: 1 }] }),
  true
);
assert.equal(isVenueCostFixedPerLocation({ currency: "RUB", period: "month", amount: 9000 }), false);

console.log("venue-cost-rules-check: ok");
