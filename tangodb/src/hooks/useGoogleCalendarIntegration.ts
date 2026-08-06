import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOrganization } from "../organization/OrganizationProvider";
import { usePermissions } from "./usePermissions";
import {
  createGoogleCalendar,
  disconnectGoogleCalendar,
  fetchMemberGoogleBinding,
  fetchMyGoogleAccounts,
  listGoogleCalendars,
  setGoogleCalendarBinding,
  startGoogleCalendarOAuth,
  requestMemberCalendarReconcile,
  type GoogleAccountSummary,
  type GoogleCalendarListEntry,
  type MemberGoogleCalendarBinding,
} from "../lib/googleCalendarApi";

export const googleCalendarQueryKeys = {
  accounts: ["google-calendar", "accounts"] as const,
  binding: (memberId: string | undefined) => ["google-calendar", "binding", memberId] as const,
  calendars: (accountId: string | undefined) => ["google-calendar", "calendars", accountId] as const,
};

export function useGoogleCalendarIntegration() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  const { membership } = usePermissions();
  const memberId = membership?.id;

  const accountsQuery = useQuery({
    queryKey: googleCalendarQueryKeys.accounts,
    queryFn: fetchMyGoogleAccounts,
  });

  const bindingQuery = useQuery({
    queryKey: googleCalendarQueryKeys.binding(memberId),
    queryFn: () => fetchMemberGoogleBinding(memberId!),
    enabled: Boolean(memberId),
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
    mutationFn: setGoogleCalendarBinding,
    onSuccess: invalidateAll,
  });

  const disconnectMutation = useMutation({
    mutationFn: disconnectGoogleCalendar,
    onSuccess: invalidateAll,
  });

  const verifyMutation = useMutation({
    mutationFn: async (googleAccountId: string) => {
      await listGoogleCalendars(googleAccountId);
      await invalidateAll();
    },
  });

  const syncFutureMutation = useMutation({
    mutationFn: async (organizationMemberId: string) => {
      await requestMemberCalendarReconcile(organizationMemberId);
      await invalidateAll();
    },
  });

  const primaryAccount: GoogleAccountSummary | null =
    accountsQuery.data?.find((a) => a.status === "active") ??
    accountsQuery.data?.[0] ??
    null;

  const activeBinding: MemberGoogleCalendarBinding | null = bindingQuery.data ?? null;

  const isConfigured = Boolean(primaryAccount && primaryAccount.status === "active" && activeBinding);

  return {
    accounts: accountsQuery.data ?? [],
    primaryAccount,
    binding: activeBinding,
    isConfigured,
    isLoading: accountsQuery.isLoading || bindingQuery.isLoading,
    isError: accountsQuery.isError || bindingQuery.isError,
    memberId,
    organizationId,
    isMemberActive: membership?.is_active ?? false,
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

export type { GoogleAccountSummary, GoogleCalendarListEntry, MemberGoogleCalendarBinding };
