import { useMemo } from "react";
import { useOrganization } from "../organization/OrganizationProvider";
import { isFinancePeriodClosed, minOpenOperationDate, orgLocalDateString } from "../lib/orgFinanceDate";

/** Closed cash period gate for money-in UI (same semantics as rental payment modals). */
export function useFinancePeriodGate(operationDate?: string | null) {
  const { settings } = useOrganization();
  const closedUntil = settings?.finance_period_closed_until ?? null;
  const orgTimezone = settings?.timezone ?? "UTC";
  const orgToday = orgLocalDateString(orgTimezone);
  const effectiveDate = operationDate ?? orgToday;

  return useMemo(
    () => ({
      closedUntil,
      orgToday,
      effectiveDate,
      isClosed: isFinancePeriodClosed(effectiveDate, closedUntil),
      minOperationDate: minOpenOperationDate(closedUntil),
    }),
    [closedUntil, orgToday, effectiveDate]
  );
}
