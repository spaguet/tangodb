import { useQuery } from "@tanstack/react-query";
import {
  fetchPersonalLessonGoogleSyncStatus,
  resolveLessonGoogleSyncUiStatus,
  type LessonGoogleSyncUiStatus,
  type PersonalLessonGoogleSyncStatus,
} from "../lib/googleCalendarApi";

export const googleCalendarSyncStatusQueryKey = (lessonId: string | null | undefined) =>
  ["google-calendar", "lesson-sync-status", lessonId] as const;

export function useGoogleCalendarSyncStatus(
  lessonId: string | null | undefined,
  options?: { enabled?: boolean }
) {
  const enabled = Boolean(lessonId) && (options?.enabled ?? true);

  const query = useQuery({
    queryKey: googleCalendarSyncStatusQueryKey(lessonId),
    queryFn: () => fetchPersonalLessonGoogleSyncStatus(lessonId!),
    enabled,
    staleTime: 30_000,
    refetchInterval: (q) => {
      const row = q.state.data as PersonalLessonGoogleSyncStatus | null | undefined;
      const ui = resolveLessonGoogleSyncUiStatus(row);
      return ui === "pending" ? 15_000 : false;
    },
  });

  const uiStatus: LessonGoogleSyncUiStatus | null = resolveLessonGoogleSyncUiStatus(query.data);

  return {
    ...query,
    uiStatus,
    row: query.data ?? null,
  };
}
