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

// Bulk copy — teachers
const bulkBase = {
  currency: "RUB",
  group: [
    {
      teacherMemberId: "t1",
      disciplineId: "d1",
      locationId: "loc-a",
      attendanceTiers: [
        { minAttendees: 0, maxAttendees: 4, amount: 100 },
        { minAttendees: 5, maxAttendees: null, amount: 150 },
      ],
    },
  ],
  personal: [
    {
      teacherMemberId: "t1",
      disciplineId: null,
      locationId: "loc-a",
      amount: 500,
    },
  ],
};

function venueCostScopeKey(section, teacherMemberId, disciplineId, locationId) {
  return `${section}:${teacherMemberId ?? "*"}:${disciplineId ?? "*"}:${locationId ?? "*"}`;
}

function venueCostScopeSpecificity(rule) {
  return Number(!!rule.teacherMemberId) + Number(!!rule.disciplineId) + Number(!!rule.locationId);
}

function venueCostRulesOverlap(a, b) {
  if (a.teacherMemberId && b.teacherMemberId && a.teacherMemberId !== b.teacherMemberId) return false;
  if (a.disciplineId && b.disciplineId && a.disciplineId !== b.disciplineId) return false;
  if (a.locationId && b.locationId && a.locationId !== b.locationId) return false;
  return true;
}

function findVenueCostAmbiguousPairs(rules) {
  const pairs = [];
  for (const section of ["group", "personal"]) {
    const list = section === "group" ? rules.group : rules.personal;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (
          venueCostRulesOverlap(a, b) &&
          venueCostScopeSpecificity(a) === venueCostScopeSpecificity(b)
        ) {
          pairs.push({
            section,
            keyA: venueCostScopeKey(section, a.teacherMemberId, a.disciplineId, a.locationId),
            keyB: venueCostScopeKey(section, b.teacherMemberId, b.disciplineId, b.locationId),
          });
        }
      }
    }
  }
  return pairs;
}

function planVenueCostTeacherBulkApply(rules, section, sourceIndex, teacherIds) {
  const list = section === "group" ? rules.group : rules.personal;
  const source = list[sourceIndex];
  const base = {
    createdRules: 0,
    skippedDuplicates: 0,
    conflicts: [],
    valid: false,
  };
  if (!source) return base;
  const existingKeys = new Set(
    list.map((rule) => venueCostScopeKey(section, rule.teacherMemberId, rule.disciplineId, rule.locationId))
  );
  const proposed = [];
  for (const teacherId of teacherIds) {
    if (!teacherId || teacherId === source.teacherMemberId) continue;
    const key = venueCostScopeKey(section, teacherId, source.disciplineId, source.locationId);
    if (existingKeys.has(key)) {
      base.skippedDuplicates += 1;
      continue;
    }
    proposed.push({
      teacherMemberId: teacherId,
      disciplineId: source.disciplineId,
      locationId: source.locationId,
      attendanceTiers: section === "group" ? source.attendanceTiers.map((t) => ({ ...t })) : undefined,
      amount: section === "personal" ? source.amount : undefined,
    });
    existingKeys.add(key);
    base.createdRules += 1;
  }
  if (base.createdRules === 0) return base;
  const merged =
    section === "group"
      ? { ...rules, group: [...rules.group, ...proposed] }
      : { ...rules, personal: [...rules.personal, ...proposed] };
  const ambiguous = findVenueCostAmbiguousPairs(merged);
  for (const pair of ambiguous) {
    const involvesNew = proposed.some(
      (rule) =>
        venueCostScopeKey(pair.section, rule.teacherMemberId, rule.disciplineId, rule.locationId) === pair.keyA ||
        venueCostScopeKey(pair.section, rule.teacherMemberId, rule.disciplineId, rule.locationId) === pair.keyB
    );
    if (involvesNew) base.conflicts.push(pair);
  }
  base.valid = base.conflicts.length === 0 && base.createdRules > 0;
  return base;
}

function applyVenueCostTeacherBulkApply(rules, plan, section, sourceIndex, teacherIds) {
  if (!plan.valid) return null;
  const list = section === "group" ? rules.group : rules.personal;
  const source = list[sourceIndex];
  if (!source) return null;
  const newRules = [];
  const existingKeys = new Set(
    list.map((rule) => venueCostScopeKey(section, rule.teacherMemberId, rule.disciplineId, rule.locationId))
  );
  for (const teacherId of teacherIds) {
    if (!teacherId || teacherId === source.teacherMemberId) continue;
    const key = venueCostScopeKey(section, teacherId, source.disciplineId, source.locationId);
    if (existingKeys.has(key)) continue;
    if (section === "group") {
      newRules.push({
        teacherMemberId: teacherId,
        disciplineId: source.disciplineId,
        locationId: source.locationId,
        attendanceTiers: source.attendanceTiers.map((t) => ({ ...t })),
      });
    } else {
      newRules.push({
        teacherMemberId: teacherId,
        disciplineId: source.disciplineId,
        locationId: source.locationId,
        amount: source.amount,
      });
    }
    existingKeys.add(key);
  }
  if (newRules.length !== plan.createdRules) return null;
  return section === "group"
    ? { ...rules, group: [...rules.group, ...newRules] }
    : { ...rules, personal: [...rules.personal, ...newRules] };
}

function planVenueCostLocationBulkCopy(rules, sourceLocationId, targetLocationIds) {
  const base = { createdRules: 0, skippedDuplicates: 0, conflicts: [], valid: false };
  if (!sourceLocationId || targetLocationIds.length === 0) return base;
  const proposed = [];
  for (const section of ["group", "personal"]) {
    const list = section === "group" ? rules.group : rules.personal;
    const sourceRules = list.filter((rule) => rule.locationId === sourceLocationId);
    const existingKeys = new Set(
      list.map((rule) => venueCostScopeKey(section, rule.teacherMemberId, rule.disciplineId, rule.locationId))
    );
    for (const source of sourceRules) {
      for (const targetLocationId of targetLocationIds) {
        if (targetLocationId === sourceLocationId) continue;
        const key = venueCostScopeKey(
          section,
          source.teacherMemberId,
          source.disciplineId,
          targetLocationId
        );
        if (existingKeys.has(key)) {
          base.skippedDuplicates += 1;
          continue;
        }
        proposed.push({
          section,
          rule: {
            teacherMemberId: source.teacherMemberId,
            disciplineId: source.disciplineId,
            locationId: targetLocationId,
            attendanceTiers: section === "group" ? source.attendanceTiers.map((t) => ({ ...t })) : undefined,
            amount: section === "personal" ? source.amount : undefined,
          },
        });
        existingKeys.add(key);
        base.createdRules += 1;
      }
    }
  }
  if (base.createdRules === 0) return base;
  const merged = { ...rules, group: [...rules.group], personal: [...rules.personal] };
  for (const item of proposed) {
    if (item.section === "group") merged.group.push(item.rule);
    else merged.personal.push(item.rule);
  }
  const ambiguous = findVenueCostAmbiguousPairs(merged);
  for (const pair of ambiguous) {
    const involvesNew = proposed.some(
      (item) =>
        venueCostScopeKey(item.section, item.rule.teacherMemberId, item.rule.disciplineId, item.rule.locationId) ===
          pair.keyA ||
        venueCostScopeKey(item.section, item.rule.teacherMemberId, item.rule.disciplineId, item.rule.locationId) ===
          pair.keyB
    );
    if (involvesNew) base.conflicts.push(pair);
  }
  base.valid = base.conflicts.length === 0 && base.createdRules > 0;
  return base;
}

const teacherIds = ["t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9", "t10", "t11"];
const bulkPlan = planVenueCostTeacherBulkApply(bulkBase, "group", 0, teacherIds);
assert.equal(bulkPlan.createdRules, 10);
assert.equal(bulkPlan.skippedDuplicates, 0);
assert.equal(bulkPlan.valid, true);
const bulkApplied = applyVenueCostTeacherBulkApply(bulkBase, bulkPlan, "group", 0, teacherIds);
assert.equal(bulkApplied.group.length, 11);

// Rollback on ambiguous conflict — equal specificity overlap
const ambiguousRules = {
  currency: "RUB",
  group: [
    {
      teacherMemberId: "t1",
      disciplineId: null,
      locationId: "loc-a",
      attendanceTiers: [{ minAttendees: 0, maxAttendees: null, amount: 100 }],
    },
    {
      teacherMemberId: "t2",
      disciplineId: "d1",
      locationId: null,
      attendanceTiers: [{ minAttendees: 0, maxAttendees: null, amount: 200 }],
    },
  ],
  personal: [],
};
const conflictPlan = planVenueCostTeacherBulkApply(ambiguousRules, "group", 0, ["t2"]);
assert.equal(conflictPlan.valid, false);
assert.ok(conflictPlan.conflicts.length > 0);
assert.equal(applyVenueCostTeacherBulkApply(ambiguousRules, conflictPlan, "group", 0, ["t2"]), null);

// Draft error code parsing (hall-rent stage 20)
function parseVenueCostDraftErrorCode(raw) {
  if (raw.startsWith("duplicate_scope:")) {
    return { code: "duplicate_scope", params: { key: raw.slice("duplicate_scope:".length) } };
  }
  if (raw.startsWith("ambiguous_scope:")) {
    const rest = raw.slice("ambiguous_scope:".length);
    const [keyA, keyB] = rest.split(":");
    return { code: "ambiguous_scope", params: { keyA: keyA ?? "", keyB: keyB ?? "" } };
  }
  return { code: raw };
}
assert.deepEqual(parseVenueCostDraftErrorCode("teacher_required"), { code: "teacher_required" });
assert.deepEqual(parseVenueCostDraftErrorCode("duplicate_scope:group:t1:*:*"), {
  code: "duplicate_scope",
  params: { key: "group:t1:*:*" },
});
assert.deepEqual(parseVenueCostDraftErrorCode("ambiguous_scope:a:b"), {
  code: "ambiguous_scope",
  params: { keyA: "a", keyB: "b" },
});

// Location copy
const locPlan = planVenueCostLocationBulkCopy(bulkApplied, "loc-a", ["loc-b", "loc-c"]);
assert.equal(locPlan.createdRules, 24); // 11 group + 1 personal × 2 locations
assert.equal(locPlan.valid, true);

// Hall-rent stage 21 — venue cost estimate calculator
function matchScopedRuleEstimate(rules, scope) {
  const matching = rules.filter(
    (rule) =>
      (!rule.teacherMemberId || rule.teacherMemberId === scope.teacherMemberId) &&
      (!rule.disciplineId || rule.disciplineId === scope.disciplineId) &&
      (!rule.locationId || rule.locationId === scope.locationId)
  );
  matching.sort((a, b) => specificity(b) - specificity(a));
  return matching[0] ?? null;
}

function findMatchingTierEstimate(tiers, attendees) {
  return (
    tiers
      .filter(
        (item) =>
          item.minAttendees <= attendees &&
          (item.maxAttendees == null || item.maxAttendees >= attendees)
      )
      .sort((a, b) => b.minAttendees - a.minAttendees)[0] ?? null
  );
}

function venueCostAmountForLessonEstimate(mode, rules, kind, scope, attendeeCount) {
  if (mode === "disabled") return { amount: 0, reason: "mode_disabled" };
  if (mode === "fixed_period") return { amount: 0, reason: "mode_fixed_period" };
  if (kind === "personal") {
    const rule = matchScopedRuleEstimate(rules.personal, scope);
    return rule ? { amount: rule.amount, reason: "matched" } : { amount: 0, reason: "no_rule" };
  }
  const rule = matchScopedRuleEstimate(rules.group, scope);
  if (!rule) return { amount: 0, reason: "no_rule" };
  const tier = findMatchingTierEstimate(rule.attendanceTiers, attendeeCount ?? 0);
  return tier ? { amount: tier.amount, reason: "matched" } : { amount: 0, reason: "no_tier" };
}

function computeFixedPeriodEstimateLines(rules, ruleFrom, ruleTo, periodStart, periodEnd) {
  const rangeStart = ruleFrom > periodStart ? ruleFrom : periodStart;
  const rangeEnd = (ruleTo ?? periodEnd) < periodEnd ? (ruleTo ?? periodEnd) : periodEnd;
  if (rangeStart > rangeEnd) return [];
  const lines = [];
  let cursor = rangeStart;
  while (cursor <= rangeEnd) {
    const periodFrom = cursor;
    let periodTo;
    if (rules.period === "month") {
      const [y, m] = cursor.slice(0, 7).split("-").map(Number);
      const last = new Date(y, m, 0).getDate();
      periodTo = `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
      if (periodTo > rangeEnd) periodTo = rangeEnd;
      const d = new Date(`${periodTo}T12:00:00`);
      d.setDate(d.getDate() + 1);
      cursor = d.toISOString().slice(0, 10);
    } else {
      periodTo = rangeEnd;
      cursor = "9999-12-31";
    }
    lines.push({ periodFrom, periodTo, amount: rules.amount });
  }
  return lines;
}

const estimateRules = {
  currency: "RUB",
  group: [
    {
      teacherMemberId: "t1",
      disciplineId: "d1",
      locationId: null,
      attendanceTiers: [
        { minAttendees: 0, maxAttendees: 4, amount: 1000 },
        { minAttendees: 5, maxAttendees: null, amount: 1500 },
      ],
    },
  ],
  personal: [{ teacherMemberId: "t1", disciplineId: null, locationId: "loc-a", amount: 700 }],
};

const groupMatch = venueCostAmountForLessonEstimate(
  "per_lesson",
  estimateRules,
  "group",
  { teacherMemberId: "t1", disciplineId: "d1", locationId: null },
  5
);
assert.equal(groupMatch.amount, 1500);
assert.equal(groupMatch.reason, "matched");

const personalMatch = venueCostAmountForLessonEstimate(
  "per_lesson",
  estimateRules,
  "personal",
  { teacherMemberId: "t1", disciplineId: "x", locationId: "loc-a" },
  null
);
assert.equal(personalMatch.amount, 700);

const noRule = venueCostAmountForLessonEstimate(
  "per_lesson",
  estimateRules,
  "group",
  { teacherMemberId: "t9", disciplineId: "d1", locationId: null },
  4
);
assert.equal(noRule.reason, "no_rule");

const fixedLines = computeFixedPeriodEstimateLines(
  { period: "month", amount: 50000, currency: "RUB" },
  "2026-03-01",
  "2026-03-31",
  "2026-03-01",
  "2026-03-31"
);
assert.equal(fixedLines.length, 1);
assert.equal(fixedLines[0].amount, 50000);

const manualTotal =
  venueCostAmountForLessonEstimate(
    "per_lesson",
    estimateRules,
    "group",
    { teacherMemberId: "t1", disciplineId: "d1", locationId: null },
    4
  ).amount * 3 +
  venueCostAmountForLessonEstimate(
    "per_lesson",
    estimateRules,
    "personal",
    { teacherMemberId: "t1", disciplineId: null, locationId: "loc-a" },
    null
  ).amount * 2;
assert.equal(manualTotal, 1000 * 3 + 700 * 2);

console.log("venue-cost-rules-check: ok");
