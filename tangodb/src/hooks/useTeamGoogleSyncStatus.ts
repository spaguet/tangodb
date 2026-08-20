import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOrgQueryScope } from "./useOrgQueryScope";
import { usePermissions } from "./usePermissions";
import {
  fetchOrganizationCalendarSyncMetrics,
  fetchTeamCalendarSyncMetrics,
  remindGoogleCalendarConnect,
  retryOrganizationCalendarSyncDeadJobs,
} from "../lib/googleCalendarApi";

export const teamGoogleSyncQueryKeys = {
  members: ["google-calendar", "team-sync-metrics"] as const,
  org: ["google-calendar", "org-sync-metrics"] as const,
};

export function useTeamGoogleSyncStatus() {
  const { role } = usePermissions();
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const canViewTeam = role === "owner" || role === "director";
  const queryClient = useQueryClient();
  const scopedMembersKey = withOrgId(teamGoogleSyncQueryKeys.members);
  const scopedOrgMetricsKey = withOrgId(teamGoogleSyncQueryKeys.org);

  const membersQuery = useQuery({
    queryKey: scopedMembersKey,
    queryFn: fetchTeamCalendarSyncMetrics,
    enabled: orgEnabled && canViewTeam,
    staleTime: 60_000,
  });

  const orgMetricsQuery = useQuery({
    queryKey: scopedOrgMetricsKey,
    queryFn: fetchOrganizationCalendarSyncMetrics,
    enabled: orgEnabled && canViewTeam,
    staleTime: 60_000,
  });

  const remindMutation = useMutation({
    mutationFn: remindGoogleCalendarConnect,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: scopedMembersKey });
    },
  });

  const retryDeadMutation = useMutation({
    mutationFn: retryOrganizationCalendarSyncDeadJobs,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: scopedMembersKey });
      await queryClient.invalidateQueries({ queryKey: scopedOrgMetricsKey });
      await queryClient.invalidateQueries({ queryKey: withOrgId(["google-calendar", "entry-sync-status"]) });
    },
  });

  return {
    canViewTeam,
    members: membersQuery.data ?? [],
    orgMetrics: orgMetricsQuery.data ?? null,
    isLoading: membersQuery.isLoading || orgMetricsQuery.isLoading,
    isError: membersQuery.isError || orgMetricsQuery.isError,
    remind: remindMutation,
    retryDead: retryDeadMutation,
    refetch: async () => {
      await Promise.all([membersQuery.refetch(), orgMetricsQuery.refetch()]);
    },
  };
}
