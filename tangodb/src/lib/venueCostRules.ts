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

export interface VenueCostFixedRules {
  currency: string;
  period: VenueCostFixedPeriod;
  amount: number;
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
    if (!finiteNonNegative(rules.amount)) errors.push("invalid_amount");
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
        ? draft.rules
        : {};
  return {
    id: draft.id ?? null,
    mode: draft.mode,
    valid_from: draft.validFrom,
    valid_to: draft.validTo,
    rules,
  };
}
