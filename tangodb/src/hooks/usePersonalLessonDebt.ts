import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import {
  mapPersonalLessonDebtTrace,
  type PersonalLessonDebtTrace,
} from "../lib/personalLessonDebtTrace";
import { useOrgQueryScope } from "./useOrgQueryScope";
import { invalidatePersonalLessonRelatedQueries } from "./usePersonalLessons";

export const personalLessonDebtTraceQueryKey = ["personalLessonDebtTrace"] as const;

export function usePersonalLessonDebtTrace(
  lessonId: string | null | undefined,
  chargeId?: string | null,
  options?: { enabled?: boolean }
) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const queryEnabled = orgEnabled && (options?.enabled ?? true) && Boolean(lessonId);

  return useQuery({
    queryKey: withOrgId([...personalLessonDebtTraceQueryKey, lessonId ?? "", chargeId ?? ""]),
    enabled: queryEnabled,
    queryFn: async (): Promise<PersonalLessonDebtTrace> => {
      const { data, error } = await supabase.rpc(
        "get_personal_lesson_debt_trace" as never,
        {
          p_lesson_id: lessonId,
          p_charge_id: chargeId ?? null,
        } as never
      );
      if (error) throw error;
      const result = data as Record<string, unknown> | null;
      if (!result || result.success === false) {
        throw new Error(String(result?.error ?? "finance.debtors.traceFailed"));
      }
      return mapPersonalLessonDebtTrace(result);
    },
    staleTime: 15 * 1000,
  });
}

export function useWriteOffPersonalLessonDebt() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrgQueryScope();

  return useMutation({
    mutationFn: async (input: {
      lessonId: string;
      chargeId?: string | null;
      reasonCode?: string;
      reasonComment?: string;
    }) => {
      const { data, error } = await supabase.rpc(
        "write_off_personal_lesson_debt" as never,
        {
          p_lesson_id: input.lessonId,
          p_charge_id: input.chargeId ?? null,
          p_reason_code: input.reasonCode ?? "wrong_amount",
          p_reason_comment: input.reasonComment ?? null,
        } as never
      );
      if (error) return { success: false as const, error: error.message };
      const result = data as { success?: boolean; error?: string; written_off?: number } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "finance.debtors.writeOffFailed" };
      }
      return { success: true as const, writtenOff: Number(result.written_off) || 0 };
    },
    onSuccess: (result) => {
      if (result.success) invalidatePersonalLessonRelatedQueries(queryClient, organizationId);
    },
  });
}
