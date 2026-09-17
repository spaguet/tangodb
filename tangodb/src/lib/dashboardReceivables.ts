import type { DebtorEntry, DebtorListItem } from "./financeReports";
import { groupPersonalLessonDebtors, sumDebtorListAmounts } from "./financeReports";

export function filterDashboardDebtorRows(
  rows: DebtorEntry[],
  personalLessonsEnabled: boolean
): DebtorEntry[] {
  return personalLessonsEnabled ? rows : rows.filter((entry) => entry.kind !== "personal");
}

export interface DashboardDebtorSummary {
  listItems: DebtorListItem[];
  recordCount: number;
  totalAmount: number;
  subscriptionCount: number;
  personalCount: number;
  rentalCount: number;
}

export function buildDashboardDebtorSummary(rows: DebtorEntry[]): DashboardDebtorSummary {
  const listItems = groupPersonalLessonDebtors(rows);
  return {
    listItems,
    recordCount: listItems.length,
    totalAmount: sumDebtorListAmounts(listItems),
    subscriptionCount: listItems.filter((item) => item.entry.kind === "subscription").length,
    personalCount: listItems.filter((item) => item.entry.kind === "personal").length,
    rentalCount: listItems.filter((item) => item.entry.kind === "rental").length,
  };
}
