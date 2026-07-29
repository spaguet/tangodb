import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { mapCapacitySnapshotRow } from "../lib/groupCapacity";
import type { GroupCapacitySnapshot } from "../types";
import { useOrgQueryScope } from "./useOrgQueryScope";

export const groupCapacityQueryKey = ["group_capacity"] as const;

export function useGroupCapacitySnapshot(classIds: string[], options?: { enabled?: boolean }) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const sortedIds = [...classIds].sort();
  const queryEnabled = orgEnabled && (options?.enabled ?? true) && sortedIds.length > 0;

  return useQuery({
    queryKey: withOrgId([...groupCapacityQueryKey, sortedIds]),
    enabled: queryEnabled,
    queryFn: async (): Promise<GroupCapacitySnapshot[]> => {
      const { data, error } = await supabase.rpc("get_groups_capacity_snapshot", {
        p_class_ids: sortedIds,
      });
      if (error) throw error;

      const payload = data as { success?: boolean; groups?: Record<string, unknown>[]; error?: string } | null;
      if (!payload?.success) {
        throw new Error(payload?.error ?? "groupCapacity.error.loadFailed");
      }

      return (payload.groups ?? []).map((row) => mapCapacitySnapshotRow(row));
    },
    staleTime: 15 * 1000,
  });
}

export function buildCapacityByGroupId(snapshots: GroupCapacitySnapshot[]): Record<string, GroupCapacitySnapshot> {
  return Object.fromEntries(snapshots.map((snapshot) => [snapshot.classId, snapshot]));
}
