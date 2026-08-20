import { asJson } from "./json";
import type { Json } from "../types/database";
import type { ExpenseCategory } from "../types/expense";

export type TeacherPayLessonKind = "personal" | "group" | "single_visit" | "all";
export type TeacherPayAmountType = "percent" | "fixed";

export interface TeacherPayRule {
  id: string;
  memberId: string;
  lessonKind: TeacherPayLessonKind;
  disciplineId: string | null;
  scheduleGroupId: string | null;
  amountType: TeacherPayAmountType;
  value: number;
  expenseCategory: ExpenseCategory | null;
  validFrom: string;
  validTo: string | null;
  createdAt: string;
}

export interface TeacherPayRuleDraft {
  id?: string;
  memberId: string;
  lessonKind: TeacherPayLessonKind;
  disciplineId: string | null;
  scheduleGroupId: string | null;
  amountType: TeacherPayAmountType;
  value: number;
  expenseCategory: ExpenseCategory | null;
  validFrom: string;
  validTo: string | null;
}

export function teacherPayRuleScopeLabel(
  rule: Pick<TeacherPayRule, "disciplineId" | "scheduleGroupId">,
  labels: {
    all: string;
    discipline: (id: string) => string | undefined;
    group: (id: string) => string | undefined;
  }
): string {
  if (rule.scheduleGroupId) {
    return labels.group(rule.scheduleGroupId) ?? rule.scheduleGroupId;
  }
  if (rule.disciplineId) {
    return labels.discipline(rule.disciplineId) ?? rule.disciplineId;
  }
  return labels.all;
}

export function validateTeacherPayRuleDraft(draft: TeacherPayRuleDraft): string[] {
  const errors: string[] = [];
  if (!draft.validFrom) errors.push("valid_from_required");
  if (draft.validTo && draft.validTo < draft.validFrom) errors.push("invalid_date_range");
  if (!Number.isFinite(draft.value) || draft.value < 0) errors.push("invalid_value");
  if (draft.amountType === "percent" && draft.value > 100) errors.push("invalid_percent");
  return errors;
}

export function teacherPayRuleToPayload(draft: TeacherPayRuleDraft): Json {
  return asJson({
    ...(draft.id ? { id: draft.id } : {}),
    member_id: draft.memberId,
    lesson_kind: draft.lessonKind,
    discipline_id: draft.disciplineId,
    schedule_group_id: draft.scheduleGroupId,
    amount_type: draft.amountType,
    value: draft.value,
    expense_category: draft.expenseCategory,
    valid_from: draft.validFrom,
    valid_to: draft.validTo,
  });
}

export function isTeacherPayRuleActive(rule: TeacherPayRule, onDate = new Date().toISOString().slice(0, 10)): boolean {
  return rule.validFrom <= onDate && (rule.validTo == null || rule.validTo >= onDate);
}

export type TeacherPayRuleStatus = "active" | "scheduled" | "ended";

export function teacherPayRuleStatus(
  rule: TeacherPayRule,
  onDate = new Date().toISOString().slice(0, 10)
): TeacherPayRuleStatus {
  if (rule.validFrom > onDate) return "scheduled";
  if (rule.validTo != null && rule.validTo < onDate) return "ended";
  return "active";
}

export function teacherPayRuleCanEdit(rule: TeacherPayRule, onDate = new Date().toISOString().slice(0, 10)): boolean {
  return teacherPayRuleStatus(rule, onDate) === "scheduled";
}

export function teacherPayStudioShareLabel(rule: Pick<TeacherPayRule, "amountType" | "value">): string {
  return rule.amountType === "percent" ? `${rule.value}%` : String(rule.value);
}

export function teacherPayTeacherShareLabel(rule: Pick<TeacherPayRule, "amountType" | "value">): string {
  if (rule.amountType === "percent") {
    return `${Math.max(0, 100 - rule.value)}%`;
  }
  return "revenue remainder";
}
