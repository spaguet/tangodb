import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { useOrgQueryScope } from "./useOrgQueryScope";
import { usePermissions } from "./usePermissions";
import { useScheduleGroups } from "./useScheduleGroups";
import type { MemberRole, TeacherScope } from "../types/organization";

export interface Location {
  id: string;
  name: string;
  address: string;
  createdAt?: string;
}

export const locationsQueryKey = ["locations"] as const;

const mapLocation = (row: Record<string, unknown>): Location => ({
  id: row.id as string,
  name: row.name as string,
  address: (row.address as string) || "",
  createdAt: row.created_at as string | undefined,
});

export function filterAccessibleLocations(
  locations: Location[],
  role: MemberRole,
  scope: TeacherScope,
  extraLocationIds: string[] = []
): Location[] {
  if (role !== "teacher") return locations;
  if (scope.all_locations) return locations;

  const allowedIds = new Set([...scope.location_ids, ...extraLocationIds]);
  if (allowedIds.size === 0) return [];
  return locations.filter((l) => allowedIds.has(l.id));
}

export function locationIdsFromScheduleGroupScope(
  scope: TeacherScope,
  groups: Array<{ id: string; locationId: string | null }>
): string[] {
  if (scope.all_groups || scope.schedule_group_ids.length === 0) return [];
  const groupIds = new Set(scope.schedule_group_ids);
  return groups
    .filter((group) => groupIds.has(group.id) && group.locationId)
    .map((group) => group.locationId as string);
}

export function useLocations() {
  const { enabled, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId(locationsQueryKey),
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from("locations").select("*").order("name");
      if (error) throw error;
      return (data ?? []).map(mapLocation);
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useAccessibleLocations() {
  const query = useLocations();
  const scheduleGroupsQuery = useScheduleGroups();
  const { role, scope } = usePermissions();

  const groupScopeLocationIds = useMemo(
    () => locationIdsFromScheduleGroupScope(scope, scheduleGroupsQuery.data ?? []),
    [scope, scheduleGroupsQuery.data]
  );

  const locations = useMemo(
    () => filterAccessibleLocations(query.data ?? [], role, scope, groupScopeLocationIds),
    [query.data, role, scope, groupScopeLocationIds]
  );

  return { ...query, locations };
}

export function useAddLocation() {
  const queryClient = useQueryClient();
  const { organizationId, withOrgId } = useOrgQueryScope();

  return useMutation({
    mutationFn: async ({ name, address }: { name: string; address: string }) => {
      if (!organizationId) {
        return { success: false as const, error: "onboarding.error.noOrgSelected" };
      }

      const trimmed = name.trim();
      if (!trimmed) return { success: false as const, error: "hooks.error.locationNameRequired" };

      const cached = queryClient.getQueryData<Location[]>(withOrgId(locationsQueryKey)) ?? [];
      if (cached.some((l) => l.name.toLowerCase() === trimmed.toLowerCase())) {
        return { success: false as const, error: "hooks.error.locationDuplicate" };
      }

      const { data, error } = await supabase
        .from("locations")
        .insert({
          organization_id: organizationId,
          name: trimmed,
          address: address.trim(),
        })
        .select("*")
        .single();

      if (error) return { success: false as const, error: error.message };
      return { success: true as const, location: mapLocation(data as Record<string, unknown>) };
    },
    onSuccess: (result) => {
      if (result.success) void queryClient.invalidateQueries({ queryKey: locationsQueryKey });
    },
  });
}

export function useUpdateLocation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      name,
      address,
    }: {
      id: string;
      name: string;
      address: string;
    }) => {
      const trimmed = name.trim();
      if (!trimmed) return { success: false as const, error: "hooks.error.locationNameRequired" };

      const { error } = await supabase
        .from("locations")
        .update({ name: trimmed, address: address.trim() })
        .eq("id", id);

      if (error) {
        if (error.code === "23505") {
          return { success: false as const, error: "hooks.error.locationDuplicateName" };
        }
        return { success: false as const, error: error.message };
      }
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) void queryClient.invalidateQueries({ queryKey: locationsQueryKey });
    },
  });
}

export function useDeleteLocation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("locations").delete().eq("id", id);
      if (error) {
        if (error.code === "23503") {
          return {
            success: false as const,
            error: "hooks.error.locationInUse",
          };
        }
        return { success: false as const, error: error.message };
      }
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) void queryClient.invalidateQueries({ queryKey: locationsQueryKey });
    },
  });
}
