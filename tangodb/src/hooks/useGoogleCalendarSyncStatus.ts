import { useQuery } from "@tanstack/react-query";
import {
  fetchScheduleEntryGoogleSyncStatus,
  resolveLessonGoogleSyncUiStatus,
  type GoogleCalendarSyncTarget,
  type LessonGoogleSyncUiStatus,
  type ScheduleEntryGoogleSyncStatus,
} from "../lib/googleCalendarApi";

export const googleCalendarSyncStatusQueryKey = (target: GoogleCalendarSyncTarget | null | undefined) =>
  [
    "google-calendar",
    "entry-sync-status",
    target?.sourceType,
    target?.sourceId,
    target?.sourceType === "group_occurrence" ? target.occurrenceDate : null,
  ] as const;

export function useGoogleCalendarSyncStatus(
  target: GoogleCalendarSyncTarget | null | undefined,
  options?: { enabled?: boolean }
) {
  const enabled = Boolean(target) && (options?.enabled ?? true);

  const query = useQuery({
    queryKey: googleCalendarSyncStatusQueryKey(target),
    queryFn: () => fetchScheduleEntryGoogleSyncStatus(target!),
    enabled,
    staleTime: 30_000,
    refetchInterval: (q) => {
      const row = q.state.data as ScheduleEntryGoogleSyncStatus | null | undefined;
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
