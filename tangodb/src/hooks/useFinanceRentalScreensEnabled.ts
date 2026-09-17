import { usePermissions } from "./usePermissions";
import { useLocationRentalHourRates } from "./useLocationRentalHourRates";

/** Cashier rental + Mini App finance screens — only when hall-rent addon is active (UX14 / U-243). */
export function useFinanceRentalScreensEnabled(): { enabled: boolean; resolving: boolean } {
  const { can } = usePermissions();
  const canRentalPayments = can("rentals.payments.write");
  const ratesQuery = useLocationRentalHourRates(canRentalPayments);
  if (!canRentalPayments) return { enabled: false, resolving: false };
  if (ratesQuery.isLoading) return { enabled: false, resolving: true };
  if (ratesQuery.isError) return { enabled: false, resolving: false };
  return { enabled: ratesQuery.data?.addonActive ?? false, resolving: false };
}
