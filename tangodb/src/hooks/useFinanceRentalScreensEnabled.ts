import { usePermissions } from "./usePermissions";
import { useLocationRentalHourRates } from "./useLocationRentalHourRates";

/** Cashier rental + Mini App finance screens — only when hall-rent addon is active (UX14 / U-243). */
export function useFinanceRentalScreensEnabled(): boolean {
  const { can } = usePermissions();
  const canRentalPayments = can("rentals.payments.write");
  const ratesQuery = useLocationRentalHourRates({ enabled: canRentalPayments });
  if (!canRentalPayments) return false;
  if (ratesQuery.isLoading) return false;
  return ratesQuery.data?.addonActive ?? false;
}
