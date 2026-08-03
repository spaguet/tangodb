import type { RentalTariffRule } from "../types";
import { timesOverlap } from "./utils";

export interface TariffRuleWithIndex {
  rule: RentalTariffRule;
  index: number;
}

export interface TariffRuleOverlapConflict {
  indexA: number;
  indexB: number;
  priority: number;
}

/** Mirrors SQL `schedule_date_ranges_overlap` for nullable open boundaries. */
export function tariffRuleDateRangesOverlap(
  fromA: string | null | undefined,
  toA: string | null | undefined,
  fromB: string | null | undefined,
  toB: string | null | undefined
): boolean {
  const aFrom = fromA?.trim() || null;
  const aTo = toA?.trim() || null;
  const bFrom = fromB?.trim() || null;
  const bTo = toB?.trim() || null;

  if (aTo && bFrom && aTo < bFrom) return false;
  if (bTo && aFrom && bTo < aFrom) return false;
  return true;
}

export function tariffRulesShareWeekday(a: RentalTariffRule, b: RentalTariffRule): boolean {
  return a.daysOfWeek.some((day) => b.daysOfWeek.includes(day));
}

/** Mirrors `_validate_tariff_rules_no_ambiguous_overlap` — equal priority + overlapping scope. */
export function findAmbiguousTariffRuleOverlaps(rules: RentalTariffRule[]): TariffRuleOverlapConflict[] {
  const conflicts: TariffRuleOverlapConflict[] = [];

  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      const a = rules[i]!;
      const b = rules[j]!;
      if (a.priority !== b.priority) continue;
      if (!tariffRulesShareWeekday(a, b)) continue;
      if (!tariffRuleDateRangesOverlap(a.validFrom, a.validTo, b.validFrom, b.validTo)) continue;
      if (!timesOverlap(a.timeStart, a.timeEnd, b.timeStart, b.timeEnd)) continue;
      conflicts.push({ indexA: i, indexB: j, priority: a.priority });
    }
  }

  return conflicts;
}

export function isTariffRuleDateRangeValid(rule: RentalTariffRule): boolean {
  const from = rule.validFrom?.trim();
  const to = rule.validTo?.trim();
  if (!from || !to) return true;
  return from <= to;
}

export function isTariffRuleTimeRangeValid(rule: RentalTariffRule): boolean {
  return rule.timeStart < rule.timeEnd;
}

export type TariffRuleValidationCode =
  | "daysRequired"
  | "timeInvalid"
  | "dateRangeInvalid"
  | "ambiguousOverlap";

export interface TariffRuleValidationIssue {
  code: TariffRuleValidationCode;
  index?: number;
  conflict?: TariffRuleOverlapConflict;
}

export function validateRentalTariffRules(rules: RentalTariffRule[]): TariffRuleValidationIssue[] {
  const issues: TariffRuleValidationIssue[] = [];

  rules.forEach((rule, index) => {
    if (rule.daysOfWeek.length === 0) {
      issues.push({ code: "daysRequired", index });
    }
    if (!isTariffRuleTimeRangeValid(rule)) {
      issues.push({ code: "timeInvalid", index });
    }
    if (!isTariffRuleDateRangeValid(rule)) {
      issues.push({ code: "dateRangeInvalid", index });
    }
  });

  for (const conflict of findAmbiguousTariffRuleOverlaps(rules)) {
    issues.push({ code: "ambiguousOverlap", conflict });
  }

  return issues;
}

/** Higher priority wins; stable tie-break by original index (approximates created_at order). */
export function sortTariffRulesByApplicationOrder(entries: TariffRuleWithIndex[]): TariffRuleWithIndex[] {
  return [...entries].sort((a, b) => {
    if (b.rule.priority !== a.rule.priority) return b.rule.priority - a.rule.priority;
    return a.index - b.index;
  });
}

export function nextTariffRulePriority(rules: RentalTariffRule[]): number {
  if (rules.length === 0) return 0;
  return Math.max(...rules.map((rule) => rule.priority)) + 1;
}

export type RulePeriodLabelFn = (key: string, params?: Record<string, string | number>) => string;

export function formatTariffRulePeriod(
  rule: RentalTariffRule,
  translate: RulePeriodLabelFn
): string {
  const from = rule.validFrom?.trim();
  const to = rule.validTo?.trim();
  if (!from && !to) return translate("rentalTariffs.rulePeriodOpen");
  if (from && to) return translate("rentalTariffs.rulePeriodRange", { from, to });
  if (from) return translate("rentalTariffs.rulePeriodFrom", { from });
  return translate("rentalTariffs.rulePeriodTo", { to: to! });
}
