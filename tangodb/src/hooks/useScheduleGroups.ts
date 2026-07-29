import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { mapScheduleGroup } from "../lib/scheduleGroups";
import type { ScheduleGroup } from "../types";
import { useOrgQueryScope } from "./useOrgQueryScope";

export const scheduleGroupsQueryKey = ["schedule_groups"] as const;

export function useScheduleGroups(options?: { enabled?: boolean }) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const queryEnabled = orgEnabled && (options?.enabled ?? true);

  return useQuery({
    queryKey: withOrgId(scheduleGroupsQueryKey),
    enabled: queryEnabled,
    queryFn: async (): Promise<ScheduleGroup[]> => {
      const { data, error } = await supabase
        .from("classes")
        .select("id, name, discipline_id, default_location_id, max_capacity")
        .order("name");
      if (error) throw error;
      return (data ?? []).map((row) => mapScheduleGroup(row as Record<string, unknown>));
    },
    staleTime: 5 * 60 * 1000,
  });
}
