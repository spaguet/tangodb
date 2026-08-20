import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import {
  teacherPayRuleToPayload,
  type TeacherPayAmountType,
  type TeacherPayLessonKind,
  type TeacherPayRule,
  type TeacherPayRuleDraft,
} from "../lib/teacherPayRules";
import type { ExpenseCategory } from "../types/expense";
import { useOrgQueryScope } from "./useOrgQueryScope";
import { orgScopedQueryFilter } from "../lib/orgQueryFilter";

export const teacherPayRulesQueryKey = ["teacher-pay-rules"] as const;

type RpcObject = Record<string, unknown>;

const nullableString = (value: unknown): string | null =>
  value == null || value === "" ? null : String(value);

export function mapTeacherPayRule(row: RpcObject): TeacherPayRule {
  return {
    id: String(row.id),
    memberId: String(row.member_id),
    lessonKind: String(row.lesson_kind) as TeacherPayLessonKind,
    disciplineId: nullableString(row.discipline_id),
    scheduleGroupId: nullableString(row.schedule_group_id),
    amountType: String(row.amount_type) as TeacherPayAmountType,
    value: Number(row.value) || 0,
    expenseCategory: nullableString(row.expense_category) as ExpenseCategory | null,
    validFrom: String(row.valid_from ?? "").slice(0, 10),
    validTo: nullableString(row.valid_to)?.slice(0, 10) ?? null,
    createdAt: String(row.created_at ?? ""),
  };
}

export function useTeacherPayRules(memberId: string | null | undefined) {
  const { enabled, withOrgId } = useOrgQueryScope();
  return useQuery({
    queryKey: withOrgId([...teacherPayRulesQueryKey, memberId ?? ""]),
    enabled: enabled && Boolean(memberId),
    queryFn: async (): Promise<TeacherPayRule[]> => {
      const { data, error } = await supabase.rpc("list_teacher_pay_rules", {
        p_member_id: memberId!,
      });
      if (error) throw error;
      const result = data as RpcObject | null;
      if (!result?.success) throw new Error(String(result?.error_code ?? "teacher_pay_rules_failed"));
      return (Array.isArray(result.rules) ? result.rules : []).map((row) =>
        mapTeacherPayRule(row as RpcObject)
      );
    },
    staleTime: 30_000,
  });
}

export function useUpsertTeacherPayRule() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrgQueryScope();
  return useMutation({
    mutationFn: async (input: { draft: TeacherPayRuleDraft; idempotencyKey?: string }) => {
      const { data, error } = await supabase.rpc("save_teacher_pay_rule", {
        p_payload: teacherPayRuleToPayload(input.draft),
        p_idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
      });
      if (error) return { success: false as const, error: error.message };
      const result = data as RpcObject | null;
      if (!result?.success) {
        return { success: false as const, error: String(result?.error_code ?? "teacher_pay_rule_save_failed") };
      }
      return {
        success: true as const,
        ruleId: String(result.rule_id),
        rule: mapTeacherPayRule((result.rule ?? {}) as RpcObject),
      };
    },
    onSuccess: (result) => {
      if (result.success) {
        void queryClient.invalidateQueries(orgScopedQueryFilter(teacherPayRulesQueryKey, organizationId));
        void queryClient.invalidateQueries({ queryKey: ["payroll"] });
        void queryClient.invalidateQueries({ queryKey: ["finance-costs"] });
      }
    },
  });
}

export function useEndTeacherPayRuleEarly() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrgQueryScope();
  return useMutation({
    mutationFn: async (input: { ruleId: string; endDate?: string; idempotencyKey?: string }) => {
      const { data, error } = await supabase.rpc("end_teacher_pay_rule_early", {
        p_rule_id: input.ruleId,
        p_end_date: input.endDate ?? new Date().toISOString().slice(0, 10),
        p_idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
      });
      if (error) return { success: false as const, error: error.message };
      const result = data as RpcObject | null;
      if (!result?.success) {
        return { success: false as const, error: String(result?.error_code ?? "teacher_pay_rule_end_failed") };
      }
      return {
        success: true as const,
        ruleId: String(result.rule_id ?? input.ruleId),
        alreadyApplied: result.already_applied === true,
      };
    },
    onSuccess: (result) => {
      if (result.success) {
        void queryClient.invalidateQueries(orgScopedQueryFilter(teacherPayRulesQueryKey, organizationId));
        void queryClient.invalidateQueries({ queryKey: ["payroll"] });
      }
    },
  });
}
