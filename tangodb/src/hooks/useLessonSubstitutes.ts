import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  assignLessonSubstituteRpc,
  clearLessonSubstituteRpc,
  fetchLessonSubstitutes,
  type AssignLessonSubstituteInput,
  type ClearLessonSubstituteInput,
} from "../lib/lessonSubstitute";
import { useOrgQueryScope } from "./useOrgQueryScope";

export const lessonSubstitutesQueryKey = ["lessonOccurrenceSubstitutes"] as const;

export function useLessonSubstitutes(options?: { enabled?: boolean }) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const queryEnabled = orgEnabled && (options?.enabled ?? true);

  return useQuery({
    queryKey: withOrgId(lessonSubstitutesQueryKey),
    enabled: queryEnabled,
    queryFn: fetchLessonSubstitutes,
    staleTime: 60 * 1000,
  });
}

function invalidateSubstituteQueries(
  queryClient: ReturnType<typeof useQueryClient>
) {
  void queryClient.invalidateQueries({ queryKey: lessonSubstitutesQueryKey, refetchType: "active" });
  void queryClient.invalidateQueries({ queryKey: ["schedule"], refetchType: "active" });
  void queryClient.invalidateQueries({ queryKey: ["personalLessons"], refetchType: "active" });
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
