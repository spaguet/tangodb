import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchScheduleEntryGoogleSyncStatus,
  GOOGLE_CALENDAR_SYNC_MAX_POLL_COUNT,
  GOOGLE_CALENDAR_SYNC_POLL_INTERVAL_MS,
  resolveLessonGoogleSyncUiStatus,
  resolveLessonGoogleSyncUiStatusWithPollCap,
  type GoogleCalendarSyncTarget,
  type LessonGoogleSyncUiStatus,
  type ScheduleEntryGoogleSyncStatus,
} from "../lib/googleCalendarApi";
import { useOrganization } from "../organization/OrganizationProvider";
import { useOrgQueryScope } from "./useOrgQueryScope";

export const googleCalendarSyncStatusQueryKey = (
  organizationId: string | null | undefined,
  target: GoogleCalendarSyncTarget | null | undefined
) => {
  const base = [
    "google-calendar",
    "entry-sync-status",
    target?.sourceType,
    target?.sourceId,
    target?.sourceType === "group_occurrence" ? target.occurrenceDate : null,
  ] as const;
  return (organizationId ? [...base, organizationId] : base) as readonly unknown[];
};

export function useGoogleCalendarSyncStatus(
  target: GoogleCalendarSyncTarget | null | undefined,
  options?: { enabled?: boolean }
) {
  const { organizationId, enabled: orgEnabled } = useOrgQueryScope();
  const { role } = useOrganization();
  const enabled = orgEnabled && Boolean(target) && (options?.enabled ?? true);
  const [pollFetchCount, setPollFetchCount] = useState(0);

  useEffect(() => {
    setPollFetchCount(0);
  }, [
    organizationId,
    target?.sourceType,
    target?.sourceId,
    target?.sourceType === "group_occurrence" ? target.occurrenceDate : null,
  ]);

  const query = useQuery({
    queryKey: googleCalendarSyncStatusQueryKey(organizationId, target),
    queryFn: () => fetchScheduleEntryGoogleSyncStatus(target!),
    enabled,
    staleTime: 30_000,
    refetchInterval: (q) => {
      const row = q.state.data as ScheduleEntryGoogleSyncStatus | null | undefined;
      if (!row?.has_pending_job) return false;
      if (q.state.dataUpdateCount >= GOOGLE_CALENDAR_SYNC_MAX_POLL_COUNT) return false;
      return GOOGLE_CALENDAR_SYNC_POLL_INTERVAL_MS;
    },
  });

  useEffect(() => {
    if (!query.isSuccess) return;
    const ui = resolveLessonGoogleSyncUiStatus(query.data);
    if (ui !== "pending") {
      setPollFetchCount(0);
      return;
    }
    setPollFetchCount((count) => count + 1);
  }, [query.dataUpdatedAt, query.isSuccess, query.data]);

  const uiStatus: LessonGoogleSyncUiStatus | null = resolveLessonGoogleSyncUiStatusWithPollCap(
    query.data,
    pollFetchCount
  );

  const canSeeLastError = role === "owner" || role === "director";
  const row =
    query.data && !canSeeLastError ? { ...query.data, last_error: null } : (query.data ?? null);

  return {
    ...query,
    uiStatus,
    row,
  };
}
