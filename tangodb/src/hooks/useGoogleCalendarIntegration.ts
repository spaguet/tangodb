import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOrganization } from "../organization/OrganizationProvider";
import { useOrgQueryScope } from "./useOrgQueryScope";
import { orgScopedQueryFilter } from "../lib/orgQueryFilter";
import { usePermissions } from "./usePermissions";
import {
  createGoogleCalendar,
  disconnectGoogleCalendar,
  fetchMemberGoogleBinding,
  fetchMyGoogleAccounts,
  listGoogleCalendars,
  setGoogleCalendarBinding,
  setFreebusyCalendarConfig,
  startGoogleCalendarOAuth,
  requestMemberCalendarReconcile,
  kickCalendarSyncInBackground,
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
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const { membership } = usePermissions();
  const memberId = membership?.id;
  const scopedBindingKey = withOrgId(
    memberId ? googleCalendarQueryKeys.binding(memberId) : (["google-calendar", "binding"] as const)
  );

  const accountsQuery = useQuery({
    queryKey: googleCalendarQueryKeys.accounts,
    queryFn: fetchMyGoogleAccounts,
  });

  const bindingQuery = useQuery({
    queryKey: scopedBindingKey,
    queryFn: () => fetchMemberGoogleBinding(memberId!),
    enabled: orgEnabled && Boolean(memberId),
  });

  const invalidateAll = async () => {
    await queryClient.invalidateQueries({ queryKey: googleCalendarQueryKeys.accounts });
    if (organizationId) {
      await queryClient.invalidateQueries(
        orgScopedQueryFilter(["google-calendar", "binding"], organizationId)
      );
      await queryClient.invalidateQueries(
        orgScopedQueryFilter(["google-calendar", "entry-sync-status"], organizationId)
      );
    }
  };

  const connectMutation = useMutation({
    mutationFn: async (input: string | { returnUrl: string; consentPurpose?: string }) => {
      const returnUrl = typeof input === "string" ? input : input.returnUrl;
      const consentPurpose = typeof input === "string" ? undefined : input.consentPurpose;
      const url = await startGoogleCalendarOAuth(returnUrl, { consentPurpose });
      window.open(url, "_blank", "noopener,noreferrer");
    },
  });

  const listCalendarsMutation = useMutation({
    mutationFn: (input: string | { googleAccountId: string; purpose?: "freebusy" }) => {
      if (typeof input === "string") {
        return listGoogleCalendars(input);
      }
      return listGoogleCalendars(input.googleAccountId, { purpose: input.purpose });
    },
  });

  const createCalendarMutation = useMutation({
    mutationFn: (googleAccountId: string) => {
      if (!organizationId) throw new Error("organization_missing");
      return createGoogleCalendar(googleAccountId, organizationId);
    },
  });

  const setBindingMutation = useMutation({
    mutationFn: setGoogleCalendarBinding,
    onSuccess: () => {
      kickCalendarSyncInBackground(organizationId);
      return invalidateAll();
    },
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
      await requestMemberCalendarReconcile(organizationMemberId, organizationId);
      await invalidateAll();
    },
  });

  const setFreebusyConfigMutation = useMutation({
    mutationFn: setFreebusyCalendarConfig,
    onSuccess: invalidateAll,
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
    setFreebusyConfig: setFreebusyConfigMutation,
    invalidateAll,
    refetch: async () => {
      await accountsQuery.refetch();
      await bindingQuery.refetch();
    },
  };
}

export type { GoogleAccountSummary, GoogleCalendarListEntry, MemberGoogleCalendarBinding };
