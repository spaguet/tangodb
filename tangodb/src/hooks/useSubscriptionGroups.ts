import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import type { SubscriptionGroupLink } from "../types";
import { useOrgQueryScope } from "./useOrgQueryScope";

export const subscriptionGroupsQueryKey = ["subscription_groups"] as const;

const mapSubscriptionGroupLink = (row: Record<string, unknown>): SubscriptionGroupLink & { subscriptionId: string } => ({
  subscriptionId: row.subscription_id as string,
  groupName: (row.group_name as string) ?? "",
  disciplineId: row.discipline_id as string,
  locationId: row.location_id != null ? String(row.location_id) : null,
});

export function useSubscriptionGroups(options?: { enabled?: boolean }) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const queryEnabled = orgEnabled && (options?.enabled ?? true);

  const query = useQuery({
    queryKey: withOrgId(subscriptionGroupsQueryKey),
    enabled: queryEnabled,
    queryFn: async () => {
      const { data, error } = await supabase.from("subscription_groups").select("*");
      if (error) throw error;
      return (data ?? []).map((row) => mapSubscriptionGroupLink(row as Record<string, unknown>));
    },
    staleTime: 30 * 1000,
  });

  const groupsBySubId = useMemo(() => {
    const map: Record<string, SubscriptionGroupLink[]> = {};
    for (const row of query.data ?? []) {
      const { subscriptionId, ...link } = row;
      if (!map[subscriptionId]) map[subscriptionId] = [];
      map[subscriptionId].push(link);
    }
    return map;
  }, [query.data]);

  return {
    ...query,
    groupsBySubId,
  };
}
