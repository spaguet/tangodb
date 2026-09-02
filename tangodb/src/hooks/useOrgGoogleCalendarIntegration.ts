import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOrganization } from "../organization/OrganizationProvider";
import { useOrgQueryScope } from "./useOrgQueryScope";
import { orgScopedQueryFilter } from "../lib/orgQueryFilter";
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
  requestOrganizationRentalsCalendarReconcile,
  kickCalendarSyncInBackground,
  type GoogleAccountSummary,
  type GoogleCalendarListEntry,
  type OrganizationGoogleCalendarBinding,
  type OrgGoogleCalendarPurpose,
} from "../lib/googleCalendarApi";

export const orgGoogleCalendarQueryKeys = {
  accounts: ["google-calendar", "accounts"] as const,
  binding: (purpose: OrgGoogleCalendarPurpose) =>
    ["google-calendar", "org-binding", purpose] as const,
};

export function useOrgGoogleCalendarIntegration(
  purpose: OrgGoogleCalendarPurpose = "events"
) {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const { role } = usePermissions();
  const scopedOrgBindingKey = withOrgId(orgGoogleCalendarQueryKeys.binding(purpose));

  const canManage = role === "owner" || role === "director";

  const bindingQuery = useQuery({
    queryKey: scopedOrgBindingKey,
    queryFn: () => fetchOrganizationGoogleBinding(purpose),
    enabled: orgEnabled && canManage,
  });

  const orgBindingEnabled = Boolean(bindingQuery.data?.enabled);

  const accountsQuery = useQuery({
    queryKey: orgGoogleCalendarQueryKeys.accounts,
    queryFn: fetchMyGoogleAccounts,
    enabled: canManage,
    refetchInterval: canManage && orgBindingEnabled ? 60_000 : false,
  });

  const invalidateAll = async () => {
    await queryClient.invalidateQueries({ queryKey: orgGoogleCalendarQueryKeys.accounts });
    if (organizationId) {
      await queryClient.invalidateQueries({ queryKey: scopedOrgBindingKey });
      await queryClient.invalidateQueries(
        orgScopedQueryFilter(["google-calendar", "entry-sync-status"], organizationId)
      );
    }
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
      return createGoogleCalendar(googleAccountId, organizationId, { purpose });
    },
  });

  const setBindingMutation = useMutation({
    mutationFn: (
      input: Omit<Parameters<typeof setOrganizationGoogleCalendarBinding>[0], "purpose">
    ) => setOrganizationGoogleCalendarBinding({ ...input, purpose }),
    onSuccess: () => {
      kickCalendarSyncInBackground(organizationId);
      return invalidateAll();
    },
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
      if (purpose === "rentals") {
        await requestOrganizationRentalsCalendarReconcile(organizationId);
      } else {
        await requestOrganizationCalendarReconcile(organizationId);
      }
      await invalidateAll();
    },
  });

  const accounts = accountsQuery.data ?? [];
  const orgBinding: OrganizationGoogleCalendarBinding | null = bindingQuery.data ?? null;

  const boundAccount: GoogleAccountSummary | null =
    accounts.find((account) => account.id === orgBinding?.google_account_id) ?? null;

  const primaryAccount: GoogleAccountSummary | null =
    boundAccount ??
    accounts.find((account) => account.status === "active") ??
    accounts[0] ??
    null;

  const isConfigured = Boolean(orgBinding?.enabled);

  return {
    canManage,
    purpose,
    accounts,
    primaryAccount,
    boundAccount,
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

export type { GoogleAccountSummary, GoogleCalendarListEntry, OrganizationGoogleCalendarBinding, OrgGoogleCalendarPurpose };
