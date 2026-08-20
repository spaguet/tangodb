import { addDays, expandSlotsToDateRange, toISODateLocal } from "./scheduleWeek";
import { DATE_CURSOR_MAX_ITERATIONS, isIsoDateString } from "./dateRecurrenceLimits";
import {
  isVenueCostFixedPerLocation,
  matchScopedRule,
  type VenueCostFixedRules,
  type VenueCostGroupRule,
  type VenueCostMode,
  type VenueCostPerLessonRules,
  type VenueCostPersonalRule,
  type VenueCostRules,
  type VenueCostVersionSnapshot,
  findMatchingAttendanceTier,
} from "./venueCostRules";
import type { PersonalLesson, ScheduleSlot } from "../types";

export type VenueCostLessonKind = "group" | "personal";

export interface VenueCostEstimateLessonInput {
  id: string;
  kind: VenueCostLessonKind;
  date: string;
  disciplineId: string | null;
  locationId: string | null;
  teacherMemberId: string | null;
  attendeeCount: number | null;
  label?: string;
}

export type VenueCostMatchReason =
  | "matched"
  | "no_rule"
  | "no_tier"
  | "mode_disabled"
  | "mode_fixed_period";

export interface VenueCostEstimateLine {
  lessonId: string;
  kind: VenueCostLessonKind;
  date: string;
  amount: number;
  reason: VenueCostMatchReason;
  ruleScope: string | null;
  label: string | null;
}

export interface VenueCostFixedPeriodLine {
  periodFrom: string;
  periodTo: string;
  locationId: string | null;
  amount: number;
}

export interface VenueCostEstimateResult {
  currency: string;
  mode: VenueCostMode;
  total: number;
  lessonLines: VenueCostEstimateLine[];
  fixedPeriodLines: VenueCostFixedPeriodLine[];
  isForecast: true;
}

export interface VenueCostEstimateFilters {
  teacherMemberId?: string | null;
  disciplineId?: string | null;
  locationId?: string | null;
}

function scopeKey(
  prefix: "group" | "personal",
  teacherMemberId: string | null,
  disciplineId: string | null,
  locationId: string | null
): string {
  return `${prefix}:${teacherMemberId ?? "*"}:${disciplineId ?? "*"}:${locationId ?? "*"}`;
}

export { findMatchingAttendanceTier } from "./venueCostRules";

export function venueCostAmountForLesson(
  mode: VenueCostMode,
  rules: VenueCostRules,
  kind: VenueCostLessonKind,
  scope: {
    disciplineId: string | null;
    locationId: string | null;
    teacherMemberId: string | null;
  },
  attendeeCount: number | null
): { amount: number; reason: VenueCostMatchReason; ruleScope: string | null } {
  if (mode === "disabled") {
    return { amount: 0, reason: "mode_disabled", ruleScope: null };
  }
  if (mode === "fixed_period") {
    return { amount: 0, reason: "mode_fixed_period", ruleScope: null };
  }

  const perLesson = rules as VenueCostPerLessonRules;
  if (kind === "personal") {
    const rule = matchScopedRule<VenueCostPersonalRule>(perLesson.personal, scope);
    if (!rule) return { amount: 0, reason: "no_rule", ruleScope: null };
    return {
      amount: rule.amount,
      reason: "matched",
      ruleScope: scopeKey("personal", rule.teacherMemberId, rule.disciplineId, rule.locationId),
    };
  }

  const rule = matchScopedRule<VenueCostGroupRule>(perLesson.group, scope);
  if (!rule) return { amount: 0, reason: "no_rule", ruleScope: null };
  const attendees = attendeeCount ?? 0;
  const tier = findMatchingAttendanceTier(rule.attendanceTiers, attendees);
  if (!tier) {
    return {
      amount: 0,
      reason: "no_tier",
      ruleScope: scopeKey("group", rule.teacherMemberId, rule.disciplineId, rule.locationId),
    };
  }
  return {
    amount: tier.amount,
    reason: "matched",
    ruleScope: scopeKey("group", rule.teacherMemberId, rule.disciplineId, rule.locationId),
  };
}

function maxIso(a: string, b: string): string {
  return a >= b ? a : b;
}

function minIso(a: string, b: string): string {
  return a <= b ? a : b;
}

function endOfMonth(isoDate: string): string {
  const [yearStr, monthStr] = isoDate.slice(0, 7).split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const lastDay = new Date(year, month, 0).getDate();
  return `${yearStr}-${monthStr}-${String(lastDay).padStart(2, "0")}`;
}

/** Fixed-period accrual windows overlapping [periodStart, periodEnd] (accept-version semantics). */
export function computeFixedPeriodEstimate(
  rules: VenueCostFixedRules,
  ruleValidFrom: string,
  ruleValidTo: string | null,
  periodStart: string,
  periodEnd: string,
  locationFilter: string | null = null
): VenueCostFixedPeriodLine[] {
  if (!isIsoDateString(periodStart) || !isIsoDateString(periodEnd)) return [];
  if (!isIsoDateString(ruleValidFrom)) return [];
  if (ruleValidTo != null && !isIsoDateString(ruleValidTo)) return [];

  const rangeStart = maxIso(ruleValidFrom, periodStart);
  const rangeEnd = minIso(ruleValidTo ?? periodEnd, periodEnd);
  if (rangeStart > rangeEnd) return [];

  const lines: VenueCostFixedPeriodLine[] = [];
  let cursor = rangeStart;

  let iterations = 0;
  while (cursor <= rangeEnd) {
    if (++iterations > DATE_CURSOR_MAX_ITERATIONS) break;
    if (!isIsoDateString(cursor)) break;

    const periodFrom = cursor;
    let periodTo: string;
    if (rules.period === "week") {
      periodTo = minIso(rangeEnd, addDays(cursor, 6));
      cursor = addDays(periodTo, 1);
    } else if (rules.period === "month") {
      periodTo = minIso(rangeEnd, endOfMonth(cursor));
      cursor = addDays(periodTo, 1);
    } else {
      periodTo = rangeEnd;
      cursor = addDays(rangeEnd, 1);
    }

    if (periodTo < periodStart || periodFrom > periodEnd) continue;

    if (isVenueCostFixedPerLocation(rules)) {
      for (const row of rules.locations ?? []) {
        if (locationFilter && row.locationId !== locationFilter) continue;
        lines.push({
          periodFrom,
          periodTo,
          locationId: row.locationId,
          amount: row.amount,
        });
      }
    } else if (!locationFilter) {
      lines.push({
        periodFrom,
        periodTo,
        locationId: null,
        amount: rules.amount,
      });
    }
  }

  return lines;
}

function passesFilters(
  lesson: VenueCostEstimateLessonInput,
  filters: VenueCostEstimateFilters
): boolean {
  if (filters.teacherMemberId && lesson.teacherMemberId !== filters.teacherMemberId) return false;
  if (filters.disciplineId && lesson.disciplineId !== filters.disciplineId) return false;
  if (filters.locationId && lesson.locationId !== filters.locationId) return false;
  return true;
}

export function buildManualVenueCostLessons(input: {
  periodStart: string;
  groupLessonCount: number;
  personalLessonCount: number;
  groupAttendeeCount: number;
  teacherMemberId: string | null;
  disciplineId: string | null;
  locationId: string | null;
}): VenueCostEstimateLessonInput[] {
  const lessons: VenueCostEstimateLessonInput[] = [];
  for (let i = 0; i < input.groupLessonCount; i += 1) {
    lessons.push({
      id: `manual-group-${i}`,
      kind: "group",
      date: input.periodStart,
      disciplineId: input.disciplineId,
      locationId: input.locationId,
      teacherMemberId: input.teacherMemberId,
      attendeeCount: input.groupAttendeeCount,
      label: null,
    });
  }
  for (let i = 0; i < input.personalLessonCount; i += 1) {
    lessons.push({
      id: `manual-personal-${i}`,
      kind: "personal",
      date: input.periodStart,
      disciplineId: input.disciplineId,
      locationId: input.locationId,
      teacherMemberId: input.teacherMemberId,
      attendeeCount: null,
      label: null,
    });
  }
  return lessons;
}

export function buildScheduleVenueCostLessons(input: {
  periodStart: string;
  periodEnd: string;
  slots: ScheduleSlot[];
  personalLessons: PersonalLesson[];
  cancelledKeys: Set<string>;
  defaultGroupAttendees: number;
  closureAttendeesByKey: Map<string, number>;
}): VenueCostEstimateLessonInput[] {
  const groupLessons = expandSlotsToDateRange(input.slots, input.periodStart, input.periodEnd);
  const lessons: VenueCostEstimateLessonInput[] = [];

  for (const lesson of groupLessons) {
    const key = `${lesson.slotId}:${lesson.date}`;
    if (input.cancelledKeys.has(key)) continue;
    const closureAttendees = input.closureAttendeesByKey.get(key);
    lessons.push({
      id: key,
      kind: "group",
      date: lesson.date,
      disciplineId: lesson.disciplineId,
      locationId: lesson.locationId,
      teacherMemberId: lesson.teacherMemberId,
      attendeeCount: closureAttendees ?? input.defaultGroupAttendees,
      label: lesson.groupName ?? null,
    });
  }

  for (const lesson of input.personalLessons) {
    if (lesson.date < input.periodStart || lesson.date > input.periodEnd) continue;
    lessons.push({
      id: lesson.id,
      kind: "personal",
      date: lesson.date,
      disciplineId: lesson.disciplineId ?? null,
      locationId: lesson.locationId ?? null,
      teacherMemberId: lesson.teacherMemberId ?? null,
      attendeeCount: null,
      label: lesson.clientDisplay ?? null,
    });
  }

  return lessons.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

export function buildVenueCostEstimate(
  snapshot: VenueCostVersionSnapshot,
  periodStart: string,
  periodEnd: string,
  lessons: VenueCostEstimateLessonInput[],
  filters: VenueCostEstimateFilters = {}
): VenueCostEstimateResult {
  const currency =
    snapshot.mode === "per_lesson"
      ? (snapshot.rules as VenueCostPerLessonRules).currency
      : snapshot.mode === "fixed_period"
        ? (snapshot.rules as VenueCostFixedRules).currency
        : "RUB";

  const lessonLines: VenueCostEstimateLine[] = [];
  let lessonTotal = 0;

  if (snapshot.mode === "per_lesson") {
    for (const lesson of lessons) {
      if (!passesFilters(lesson, filters)) continue;
      const { amount, reason, ruleScope } = venueCostAmountForLesson(
        snapshot.mode,
        snapshot.rules,
        lesson.kind,
        {
          disciplineId: lesson.disciplineId,
          locationId: lesson.locationId,
          teacherMemberId: lesson.teacherMemberId,
        },
        lesson.attendeeCount
      );
      lessonLines.push({
        lessonId: lesson.id,
        kind: lesson.kind,
        date: lesson.date,
        amount,
        reason,
        ruleScope,
        label: lesson.label ?? null,
      });
      lessonTotal += amount;
    }
  }

  const fixedPeriodLines =
    snapshot.mode === "fixed_period"
      ? computeFixedPeriodEstimate(
          snapshot.rules as VenueCostFixedRules,
          snapshot.validFrom,
          snapshot.validTo,
          periodStart,
          periodEnd,
          filters.locationId ?? null
        )
      : [];

  const fixedTotal = fixedPeriodLines.reduce((sum, line) => sum + line.amount, 0);

  return {
    currency,
    mode: snapshot.mode,
    total: roundMoney(lessonTotal + fixedTotal),
    lessonLines,
    fixedPeriodLines,
    isForecast: true,
  };
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function defaultVenueCostEstimatePeriod(): { start: string; end: string } {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return { start: toISODateLocal(start), end: toISODateLocal(end) };
}
