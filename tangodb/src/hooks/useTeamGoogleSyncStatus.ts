import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePermissions } from "./usePermissions";
import {
  fetchOrganizationCalendarSyncMetrics,
  fetchTeamCalendarSyncMetrics,
  remindGoogleCalendarConnect,
} from "../lib/googleCalendarApi";

export const teamGoogleSyncQueryKeys = {
  members: ["google-calendar", "team-sync-metrics"] as const,
  org: ["google-calendar", "org-sync-metrics"] as const,
};

export function useTeamGoogleSyncStatus() {
  const { role } = usePermissions();
  const canViewTeam = role === "owner" || role === "director";
  const queryClient = useQueryClient();

  const membersQuery = useQuery({
    queryKey: teamGoogleSyncQueryKeys.members,
    queryFn: fetchTeamCalendarSyncMetrics,
    enabled: canViewTeam,
    staleTime: 60_000,
  });

  const orgMetricsQuery = useQuery({
    queryKey: teamGoogleSyncQueryKeys.org,
    queryFn: fetchOrganizationCalendarSyncMetrics,
    enabled: canViewTeam,
    staleTime: 60_000,
  });

  const remindMutation = useMutation({
    mutationFn: remindGoogleCalendarConnect,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["google-calendar", "team-sync-metrics"] });
    },
  });

  return {
    canViewTeam,
    members: membersQuery.data ?? [],
    orgMetrics: orgMetricsQuery.data ?? null,
    isLoading: membersQuery.isLoading || orgMetricsQuery.isLoading,
    isError: membersQuery.isError || orgMetricsQuery.isError,
    remind: remindMutation,
    refetch: async () => {
      await Promise.all([membersQuery.refetch(), orgMetricsQuery.refetch()]);
    },
  };
}
