import { useQuery } from "@tanstack/react-query";
import { fetchScheduleCalendarSyncLabels } from "../lib/googleCalendarApi";
import { buildScheduleCalendarSyncMap } from "../lib/scheduleCalendarSync";
import { useOrgQueryScope } from "./useOrgQueryScope";

export const scheduleCalendarSyncLabelsQueryKey = (dateFrom: string, dateTo: string) =>
  ["google-calendar", "schedule-sync-labels", dateFrom, dateTo] as const;

export function useScheduleCalendarSyncLabels(
  dateFrom: string | undefined,
  dateTo: string | undefined,
  options?: { enabled?: boolean }
) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const enabled =
    orgEnabled &&
    Boolean(dateFrom && dateTo) &&
    (options?.enabled ?? true);

  const query = useQuery({
    queryKey: withOrgId(scheduleCalendarSyncLabelsQueryKey(dateFrom ?? "", dateTo ?? "")),
    queryFn: () => fetchScheduleCalendarSyncLabels(dateFrom!, dateTo!),
    enabled,
    staleTime: 60_000,
  });

  const map = buildScheduleCalendarSyncMap(query.data ?? []);

  return {
    ...query,
    map,
  };
}
