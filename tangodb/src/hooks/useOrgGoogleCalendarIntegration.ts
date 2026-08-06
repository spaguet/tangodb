import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOrganization } from "../organization/OrganizationProvider";
import { usePermissions } from "./usePermissions";
import {
  createGoogleCalendar,
  disconnectGoogleCalendar,
  fetchOrganizationGoogleBinding,
  fetchMyGoogleAccounts,
  listGoogleCalendars,
  setOrganizationGoogleCalendarBinding,
  startGoogleCalendarOAuth,
  requestOrganizationCalendarReconcile,
  type GoogleAccountSummary,
  type GoogleCalendarListEntry,
  type OrganizationGoogleCalendarBinding,
} from "../lib/googleCalendarApi";

export const orgGoogleCalendarQueryKeys = {
  accounts: ["google-calendar", "accounts"] as const,
  binding: ["google-calendar", "org-binding"] as const,
};

export function useOrgGoogleCalendarIntegration() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  const { role } = usePermissions();

  const canManage = role === "owner" || role === "director";

  const accountsQuery = useQuery({
    queryKey: orgGoogleCalendarQueryKeys.accounts,
    queryFn: fetchMyGoogleAccounts,
    enabled: canManage,
  });

  const bindingQuery = useQuery({
    queryKey: orgGoogleCalendarQueryKeys.binding,
    queryFn: fetchOrganizationGoogleBinding,
    enabled: canManage,
  });

  const invalidateAll = async () => {
    await queryClient.invalidateQueries({ queryKey: ["google-calendar"] });
  };

  const connectMutation = useMutation({
    mutationFn: async (returnUrl: string) => {
      const url = await startGoogleCalendarOAuth(returnUrl);
      window.open(url, "_blank", "noopener,noreferrer");
    },
  });

  const listCalendarsMutation = useMutation({
    mutationFn: (googleAccountId: string) => listGoogleCalendars(googleAccountId),
  });

  const createCalendarMutation = useMutation({
    mutationFn: (googleAccountId: string) => {
      if (!organizationId) throw new Error("organization_missing");
      return createGoogleCalendar(googleAccountId, organizationId);
    },
  });

  const setBindingMutation = useMutation({
    mutationFn: setOrganizationGoogleCalendarBinding,
    onSuccess: invalidateAll,
  });

  const disconnectMutation = useMutation({
    mutationFn: (input: { deleteFutureEvents?: boolean }) =>
      disconnectGoogleCalendar({
        organizationBindingId: bindingQuery.data?.id,
        deleteFutureEvents: input.deleteFutureEvents ?? false,
      }),
    onSuccess: invalidateAll,
  });

  const verifyMutation = useMutation({
    mutationFn: async (googleAccountId: string) => {
      await listGoogleCalendars(googleAccountId);
      await invalidateAll();
    },
  });

  const syncFutureMutation = useMutation({
    mutationFn: async () => {
      await requestOrganizationCalendarReconcile();
      await invalidateAll();
    },
  });

  const primaryAccount: GoogleAccountSummary | null =
    accountsQuery.data?.find((a) => a.status === "active") ??
    accountsQuery.data?.[0] ??
    null;

  const orgBinding: OrganizationGoogleCalendarBinding | null = bindingQuery.data ?? null;

  const isConfigured = Boolean(primaryAccount && primaryAccount.status === "active" && orgBinding);

  return {
    canManage,
    accounts: accountsQuery.data ?? [],
    primaryAccount,
    binding: orgBinding,
    isConfigured,
    isLoading: accountsQuery.isLoading || bindingQuery.isLoading,
    isError: accountsQuery.isError || bindingQuery.isError,
    organizationId,
    connect: connectMutation,
    listCalendars: listCalendarsMutation,
    createCalendar: createCalendarMutation,
    setBinding: setBindingMutation,
    disconnect: disconnectMutation,
    verify: verifyMutation,
    syncFuture: syncFutureMutation,
    invalidateAll,
    refetch: async () => {
      await accountsQuery.refetch();
      await bindingQuery.refetch();
    },
  };
}

export type { GoogleAccountSummary, GoogleCalendarListEntry, OrganizationGoogleCalendarBinding };
