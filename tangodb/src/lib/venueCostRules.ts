export type VenueCostMode = "per_lesson" | "fixed_period" | "disabled";
export type VenueCostRuleStatusCode =
  | "active"
  | "disabled"
  | "not_configured"
  | "inactive"
  | "expired_ack_required";
export type VenueCostFixedPeriod = "week" | "month" | "custom";

export interface VenueCostAttendanceTier {
  minAttendees: number;
  maxAttendees: number | null;
  amount: number;
}

export interface VenueCostGroupRule {
  teacherMemberId: string | null;
  disciplineId: string | null;
  locationId: string | null;
  attendanceTiers: VenueCostAttendanceTier[];
}

export interface VenueCostPersonalRule {
  teacherMemberId: string | null;
  disciplineId: string | null;
  locationId: string | null;
  amount: number;
}

export interface VenueCostPerLessonRules {
  currency: string;
  group: VenueCostGroupRule[];
  personal: VenueCostPersonalRule[];
}

export interface VenueCostFixedLocationAmount {
  locationId: string;
  amount: number;
}

export interface VenueCostFixedRules {
  currency: string;
  period: VenueCostFixedPeriod;
  /** Org-wide amount when `locations` is empty (legacy). */
  amount: number;
  locations?: VenueCostFixedLocationAmount[];
}

export function isVenueCostFixedPerLocation(rules: VenueCostFixedRules): boolean {
  return (rules.locations?.length ?? 0) > 0;
}

export function buildFixedLocationAmounts(
  locations: Array<{ id: string }>,
  existing?: VenueCostFixedLocationAmount[]
): VenueCostFixedLocationAmount[] {
  const byId = new Map((existing ?? []).map((row) => [row.locationId, row.amount]));
  return locations.map((loc) => ({
    locationId: loc.id,
    amount: byId.get(loc.id) ?? 0,
  }));
}

export type VenueCostRules = VenueCostPerLessonRules | VenueCostFixedRules | Record<string, never>;

export interface VenueCostRuleDraft {
  id?: string;
  mode: VenueCostMode;
  validFrom: string;
  validTo: string | null;
  rules: VenueCostRules;
}

const finiteNonNegative = (value: number) => Number.isFinite(value) && value >= 0;

export function validateVenueCostDraft(draft: VenueCostRuleDraft): string[] {
  const errors: string[] = [];
  if (!draft.validFrom) errors.push("valid_from_required");
  if (draft.validTo && draft.validTo < draft.validFrom) errors.push("invalid_date_range");
  if (draft.mode === "fixed_period" && !draft.validTo) errors.push("valid_to_required");

  if (draft.mode === "fixed_period") {
    const rules = draft.rules as VenueCostFixedRules;
    if (!["week", "month", "custom"].includes(rules.period)) errors.push("invalid_period");
    if (isVenueCostFixedPerLocation(rules)) {
      for (const row of rules.locations ?? []) {
        if (!row.locationId) errors.push("fixed_location_required");
        if (!finiteNonNegative(row.amount)) errors.push("invalid_amount");
      }
    } else if (!finiteNonNegative(rules.amount)) {
      errors.push("invalid_amount");
    }
  }

  if (draft.mode === "per_lesson") {
    const rules = draft.rules as VenueCostPerLessonRules;
    if (!rules.group.length && !rules.personal.length) errors.push("lesson_types_required");
    for (const rule of rules.personal) {
      if (!rule.teacherMemberId) errors.push("teacher_required");
      if (!finiteNonNegative(rule.amount)) errors.push("invalid_personal_amount");
    }
    for (const rule of rules.group) {
      if (!rule.teacherMemberId) errors.push("teacher_required");
      if (!rule.attendanceTiers.length) {
        errors.push("group_tiers_required");
        continue;
      }
      let expectedMin: number | null = 0;
      for (const tier of [...rule.attendanceTiers].sort((a, b) => a.minAttendees - b.minAttendees)) {
        if (
          expectedMin == null ||
          tier.minAttendees !== expectedMin ||
          tier.minAttendees < 0 ||
          (tier.maxAttendees != null && tier.maxAttendees < tier.minAttendees) ||
          !finiteNonNegative(tier.amount)
        ) {
          errors.push("invalid_group_tiers");
          break;
        }
        expectedMin = tier.maxAttendees == null ? null : tier.maxAttendees + 1;
      }
      if (expectedMin != null) errors.push("group_tiers_must_be_open_ended");
    }
  }
  return [...new Set(errors)];
}

function specificity(rule: {
  teacherMemberId: string | null;
  disciplineId: string | null;
  locationId: string | null;
}): number {
  return Number(!!rule.teacherMemberId) + Number(!!rule.disciplineId) + Number(!!rule.locationId);
}

export interface VenueCostPreviewScope {
  teacherMemberId: string | null;
  disciplineId: string | null;
  locationId: string | null;
}

export function isVenueCostPreviewScopeReady(scope: VenueCostPreviewScope): boolean {
  return !!scope.teacherMemberId;
}

/** First group rule with a teacher, else first group rule — for default preview scope. */
export function defaultGroupPreviewScope(rules: VenueCostPerLessonRules): VenueCostPreviewScope {
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

export function computeGroupPreviewPair(
  rules: VenueCostPerLessonRules,
  scope: VenueCostPreviewScope
): { four: number; five: number } | null {
  if (!isVenueCostPreviewScopeReady(scope)) return null;
  return {
    four: previewGroupVenueCost(rules, 4, scope.disciplineId, scope.locationId, scope.teacherMemberId),
    five: previewGroupVenueCost(rules, 5, scope.disciplineId, scope.locationId, scope.teacherMemberId),
  };
}

export function previewGroupVenueCost(
  rules: VenueCostPerLessonRules,
  attendees: number,
  disciplineId: string | null = null,
  locationId: string | null = null,
  teacherMemberId: string | null = null
): number {
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

export interface VenueCostVersionSnapshot {
  mode: VenueCostMode;
  validFrom: string;
  validTo: string | null;
  rules: VenueCostRules;
}

export type VenueCostDiffKind = "added" | "removed" | "changed";

export interface VenueCostDiffEntry {
  kind: VenueCostDiffKind;
  section: "meta" | "group" | "personal" | "fixed";
  key: string;
}

function scopeKey(
  prefix: "group" | "personal",
  teacherMemberId: string | null,
  disciplineId: string | null,
  locationId: string | null
): string {
  return `${prefix}:${teacherMemberId ?? "*"}:${disciplineId ?? "*"}:${locationId ?? "*"}`;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function pushMetaDiff(
  entries: VenueCostDiffEntry[],
  field: string,
  left: unknown,
  right: unknown
) {
  if (left !== right) {
    entries.push({ kind: "changed", section: "meta", key: field });
  }
}

function diffPerLessonRules(
  draft: VenueCostPerLessonRules,
  active: VenueCostPerLessonRules,
  entries: VenueCostDiffEntry[]
) {
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
    if (stableJson(rule.attendanceTiers) !== stableJson(baseline.attendanceTiers)) {
      entries.push({ kind: "changed", section: "group", key });
    }
  }
  for (const key of activeGroup.keys()) {
    if (!draftGroup.has(key)) entries.push({ kind: "removed", section: "group", key });
  }

  const draftPersonal = new Map(
    draft.personal.map((rule) => [
      scopeKey("personal", rule.teacherMemberId, rule.disciplineId, rule.locationId),
      rule,
    ])
  );
  const activePersonal = new Map(
    active.personal.map((rule) => [
      scopeKey("personal", rule.teacherMemberId, rule.disciplineId, rule.locationId),
      rule,
    ])
  );
  for (const [key, rule] of draftPersonal) {
    const baseline = activePersonal.get(key);
    if (!baseline) {
      entries.push({ kind: "added", section: "personal", key });
      continue;
    }
    if (rule.amount !== baseline.amount) {
      entries.push({ kind: "changed", section: "personal", key });
    }
  }
  for (const key of activePersonal.keys()) {
    if (!draftPersonal.has(key)) entries.push({ kind: "removed", section: "personal", key });
  }
}

/** Compare draft snapshot against active accepted version (add / remove / change). */
export function diffVenueCostVersions(
  draft: VenueCostVersionSnapshot,
  active: VenueCostVersionSnapshot | null
): VenueCostDiffEntry[] {
  if (!active) {
    const entries: VenueCostDiffEntry[] = [{ kind: "added", section: "meta", key: "version" }];
    if (draft.mode === "per_lesson") {
      for (const rule of (draft.rules as VenueCostPerLessonRules).group) {
        entries.push({
          kind: "added",
          section: "group",
          key: scopeKey("group", rule.teacherMemberId, rule.disciplineId, rule.locationId),
        });
      }
      for (const rule of (draft.rules as VenueCostPerLessonRules).personal) {
        entries.push({
          kind: "added",
          section: "personal",
          key: scopeKey("personal", rule.teacherMemberId, rule.disciplineId, rule.locationId),
        });
      }
    } else if (draft.mode === "fixed_period") {
      entries.push({ kind: "added", section: "fixed", key: "fixed_period" });
    }
    return entries;
  }

  const entries: VenueCostDiffEntry[] = [];
  pushMetaDiff(entries, "mode", draft.mode, active.mode);
  pushMetaDiff(entries, "validFrom", draft.validFrom, active.validFrom);
  pushMetaDiff(entries, "validTo", draft.validTo, active.validTo);

  if (draft.mode !== active.mode) {
    if (active.mode === "per_lesson") {
      for (const rule of (active.rules as VenueCostPerLessonRules).group) {
        entries.push({
          kind: "removed",
          section: "group",
          key: scopeKey("group", rule.teacherMemberId, rule.disciplineId, rule.locationId),
        });
      }
      for (const rule of (active.rules as VenueCostPerLessonRules).personal) {
        entries.push({
          kind: "removed",
          section: "personal",
          key: scopeKey("personal", rule.teacherMemberId, rule.disciplineId, rule.locationId),
        });
      }
    } else if (active.mode === "fixed_period") {
      entries.push({ kind: "removed", section: "fixed", key: "fixed_period" });
    }
    if (draft.mode === "per_lesson") {
      for (const rule of (draft.rules as VenueCostPerLessonRules).group) {
        entries.push({
          kind: "added",
          section: "group",
          key: scopeKey("group", rule.teacherMemberId, rule.disciplineId, rule.locationId),
        });
      }
      for (const rule of (draft.rules as VenueCostPerLessonRules).personal) {
        entries.push({
          kind: "added",
          section: "personal",
          key: scopeKey("personal", rule.teacherMemberId, rule.disciplineId, rule.locationId),
        });
      }
    } else if (draft.mode === "fixed_period") {
      entries.push({ kind: "added", section: "fixed", key: "fixed_period" });
    }
    return entries;
  }

  if (draft.mode === "per_lesson") {
    diffPerLessonRules(
      draft.rules as VenueCostPerLessonRules,
      active.rules as VenueCostPerLessonRules,
      entries
    );
  } else if (draft.mode === "fixed_period") {
    const draftRules = draft.rules as VenueCostFixedRules;
    const activeRules = active.rules as VenueCostFixedRules;
    const draftLocKey = (draftRules.locations ?? [])
      .map((row) => `${row.locationId}:${row.amount}`)
      .sort()
      .join("|");
    const activeLocKey = (activeRules.locations ?? [])
      .map((row) => `${row.locationId}:${row.amount}`)
      .sort()
      .join("|");
    if (
      draftRules.amount !== activeRules.amount ||
      draftRules.period !== activeRules.period ||
      draftRules.currency !== activeRules.currency ||
      draftLocKey !== activeLocKey
    ) {
      entries.push({ kind: "changed", section: "fixed", key: "fixed_period" });
    }
  }

  return entries;
}

export function venueCostDraftToPayload(draft: VenueCostRuleDraft): Record<string, unknown> {
  const rules =
    draft.mode === "per_lesson"
      ? {
          currency: (draft.rules as VenueCostPerLessonRules).currency,
          group: (draft.rules as VenueCostPerLessonRules).group.map((rule) => ({
            teacher_member_id: rule.teacherMemberId,
            discipline_id: rule.disciplineId,
            location_id: rule.locationId,
            attendance_tiers: rule.attendanceTiers.map((tier) => ({
              min_attendees: tier.minAttendees,
              max_attendees: tier.maxAttendees,
              amount: tier.amount,
            })),
          })),
          personal: (draft.rules as VenueCostPerLessonRules).personal.map((rule) => ({
            teacher_member_id: rule.teacherMemberId,
            discipline_id: rule.disciplineId,
            location_id: rule.locationId,
            amount: rule.amount,
          })),
        }
      : draft.mode === "fixed_period"
        ? (() => {
            const fixed = draft.rules as VenueCostFixedRules;
            const payload: Record<string, unknown> = {
              currency: fixed.currency,
              period: fixed.period,
              amount: fixed.amount,
            };
            if (isVenueCostFixedPerLocation(fixed)) {
              payload.locations = fixed.locations!.map((row) => ({
                location_id: row.locationId,
                amount: row.amount,
              }));
            }
            return payload;
          })()
        : {};
  return {
    id: draft.id ?? null,
    mode: draft.mode,
    valid_from: draft.validFrom,
    valid_to: draft.validTo,
    rules,
  };
}
