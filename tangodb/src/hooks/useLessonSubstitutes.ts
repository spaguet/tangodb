import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  assignLessonSubstituteRpc,
  clearLessonSubstituteRpc,
  fetchLessonSubstitutes,
  type AssignLessonSubstituteInput,
  type ClearLessonSubstituteInput,
  type LessonSubstitutesDateRange,
} from "../lib/lessonSubstitute";
import { useOrgQueryScope } from "./useOrgQueryScope";

export const lessonSubstitutesQueryKey = ["lessonOccurrenceSubstitutes"] as const;

export function useLessonSubstitutes(options?: {
  enabled?: boolean;
  dateRange?: LessonSubstitutesDateRange;
}) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const queryEnabled = orgEnabled && (options?.enabled ?? true);
  const dateRange = options?.dateRange;

  return useQuery({
    queryKey: withOrgId([
      ...lessonSubstitutesQueryKey,
      dateRange?.start ?? null,
      dateRange?.end ?? null,
    ]),
    enabled: queryEnabled,
    queryFn: () => fetchLessonSubstitutes({ dateRange }),
    staleTime: 60 * 1000,
  });
}

function invalidateSubstituteQueries(
  queryClient: ReturnType<typeof useQueryClient>
) {
  void queryClient.invalidateQueries({ queryKey: lessonSubstitutesQueryKey, refetchType: "active" });
  void queryClient.invalidateQueries({ queryKey: ["schedule"], refetchType: "active" });
  void queryClient.invalidateQueries({ queryKey: ["personalLessons"], refetchType: "active" });
  void queryClient.invalidateQueries({
    queryKey: ["accessibleLocations", "teacherSubstituteSlots"],
    refetchType: "active",
  });
}

export function useAssignLessonSubstitute() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: AssignLessonSubstituteInput) => assignLessonSubstituteRpc(input),
    onSuccess: (result) => {
      if (result.success) invalidateSubstituteQueries(queryClient);
    },
  });
}

export function useClearLessonSubstitute() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ClearLessonSubstituteInput) => clearLessonSubstituteRpc(input),
    onSuccess: (result) => {
      if (result.success) invalidateSubstituteQueries(queryClient);
    },
  });
}
