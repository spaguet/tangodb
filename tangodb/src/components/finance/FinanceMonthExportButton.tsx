import { useState } from "react";
import { Download } from "lucide-react";
import { useToast } from "../../App";
import { useExpensesForMonth } from "../../hooks/useExpenses";
import { useFinancialDebtors } from "../../hooks/useFinancialDebtors";
import { usePayments } from "../../hooks/usePayments";
import { useRentalPayments } from "../../hooks/useRentalPayments";
import { useFinanceCosts } from "../../hooks/useVenueCosts";
import { memberListLabel, useTeamMembers } from "../../hooks/useTeamMembers";
import { useI18n } from "../../hooks/useI18n";
import { exportAllFinancialCsv } from "../../lib/exportFinancialCsv";
import { monthDateRange } from "../../lib/financeReports";

interface FinanceMonthExportButtonProps {
  yearMonth: string;
  className?: string;
}

export default function FinanceMonthExportButton({ yearMonth, className }: FinanceMonthExportButtonProps) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [exporting, setExporting] = useState(false);
  const range = monthDateRange(yearMonth);
  const paymentsQuery = usePayments({ dateFrom: range.dateFrom, dateTo: range.dateTo });
  const rentalPaymentsQuery = useRentalPayments({ dateFrom: range.dateFrom, dateTo: range.dateTo });
  const expensesQuery = useExpensesForMonth(yearMonth);
  const financeCostsQuery = useFinanceCosts(range.dateFrom, range.dateTo);
  const debtorsQuery = useFinancialDebtors();
  const teamQuery = useTeamMembers();

  const handleExport = async () => {
    setExporting(true);
    try {
      const memberNameById = new Map(
        (teamQuery.data ?? []).map((member) => [member.id, memberListLabel(member, locale)])
      );
      const result = await exportAllFinancialCsv({
        payments: paymentsQuery.data ?? [],
        rentalRegisterEntries: rentalPaymentsQuery.data ?? [],
        expenses: expensesQuery.data ?? [],
        venueCostEntries: financeCostsQuery.data?.entries ?? [],
        debtors: debtorsQuery.data ?? [],
        statsMonth: yearMonth,
        locale,
        memberNameById,
      });
      if (result.exported === 0) {
        toast(t("common.nothingToExport"), "info");
        return;
      }
      toast(t("common.exportedFiles", { count: result.exported }), "success");
    } catch {
      toast(t("common.exportFinanceFailed"), "error");
    } finally {
      setExporting(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void handleExport()}
      disabled={exporting}
      className={
        className ??
        "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-gold-700 bg-gold-50 border border-gold-100 hover:bg-gold-100 disabled:opacity-50"
      }
    >
      <Download className={`w-3.5 h-3.5 ${exporting ? "animate-pulse" : ""}`} />
      {t("finance.export.month")}
    </button>
  );
}
