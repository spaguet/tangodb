import { useMemo } from "react";
import { useGoogleCalendarIntegration } from "./useGoogleCalendarIntegration";
import { useOrgGoogleCalendarIntegration } from "./useOrgGoogleCalendarIntegration";
import { isGoogleCalendarSyncCredentialBroken } from "../lib/googleCalendarSyncHealth";
import type { GoogleAccountSummary, OrganizationGoogleCalendarBinding } from "../lib/googleCalendarApi";

function orgBindingStopped(
  canManage: boolean,
  accounts: GoogleAccountSummary[],
  binding: OrganizationGoogleCalendarBinding | null
): GoogleAccountSummary | null {
  if (!canManage || !binding?.enabled) return null;
  const account = accounts.find((item) => item.id === binding.google_account_id);
  if (!account) return null;
  return isGoogleCalendarSyncCredentialBroken(account, binding) ? account : null;
}

export function useGoogleCalendarSyncStopped() {
  const memberGcal = useGoogleCalendarIntegration();
  const orgEventsGcal = useOrgGoogleCalendarIntegration("events");
  const orgRentalsGcal = useOrgGoogleCalendarIntegration("rentals");

  const memberStopped = isGoogleCalendarSyncCredentialBroken(
    memberGcal.primaryAccount,
    memberGcal.binding
  );
  const orgEventsStoppedAccount = orgBindingStopped(
    orgEventsGcal.canManage,
    orgEventsGcal.accounts,
    orgEventsGcal.binding
  );
  const orgRentalsStoppedAccount = orgBindingStopped(
    orgRentalsGcal.canManage,
    orgRentalsGcal.accounts,
    orgRentalsGcal.binding
  );

  const stopped = memberStopped || Boolean(orgEventsStoppedAccount) || Boolean(orgRentalsStoppedAccount);

  const account: GoogleAccountSummary | null = useMemo(() => {
    if (memberStopped && memberGcal.primaryAccount) return memberGcal.primaryAccount;
    if (orgEventsStoppedAccount) return orgEventsStoppedAccount;
    if (orgRentalsStoppedAccount) return orgRentalsStoppedAccount;
    return memberGcal.primaryAccount ?? orgEventsGcal.primaryAccount ?? orgRentalsGcal.primaryAccount ?? null;
  }, [
    memberStopped,
    memberGcal.primaryAccount,
    orgEventsStoppedAccount,
    orgRentalsStoppedAccount,
    orgEventsGcal.primaryAccount,
    orgRentalsGcal.primaryAccount,
  ]);

  return {
    stopped,
    account,
    isLoading:
      memberGcal.isLoading ||
      (orgEventsGcal.canManage && (orgEventsGcal.isLoading || orgRentalsGcal.isLoading)),
    refetch: async () => {
      await memberGcal.refetch();
      if (orgEventsGcal.canManage) {
        await orgEventsGcal.refetch();
        await orgRentalsGcal.refetch();
      }
    },
  };
}
