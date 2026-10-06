import { usePermissions } from "./usePermissions";
import { useOrgEdition } from "./useOrgEdition";

/** Cashier rental + Mini App finance screens — Pro `hall_rent` (E2 / F117). */
export function useFinanceRentalScreensEnabled(): { enabled: boolean; resolving: boolean } {
  const { can } = usePermissions();
  const { editionAllows, editionLoading } = useOrgEdition();
  const canRentalPayments = can("rentals.payments.write");
  if (!canRentalPayments) return { enabled: false, resolving: false };
  if (editionLoading) return { enabled: false, resolving: true };
  return { enabled: editionAllows("hall_rent"), resolving: false };
}
