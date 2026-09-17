import { useMemo } from "react";
import { buildDashboardDebtorSummary, filterDashboardDebtorRows } from "../lib/dashboardReceivables";
import { useFinancialDebtors } from "./useFinancialDebtors";
import { usePersonalLessonsModuleEnabled } from "./useOrgModules";

export function useDashboardDebtorMetrics(options?: { enabled?: boolean }) {
  const personalLessonsEnabled = usePersonalLessonsModuleEnabled();
  const query = useFinancialDebtors({ enabled: options?.enabled });
  const summary = useMemo(() => {
    const rows = filterDashboardDebtorRows(query.data ?? [], personalLessonsEnabled);
    return buildDashboardDebtorSummary(rows);
  }, [query.data, personalLessonsEnabled]);

  return { ...query, summary };
}
