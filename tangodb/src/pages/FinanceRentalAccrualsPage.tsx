import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, FileBarChart } from "lucide-react";
import LoadingState from "../components/ui/LoadingState";
import QueryErrorState from "../components/ui/QueryErrorState";
import { useRentalAccrualReport } from "../hooks/useRentalInvoices";
import { useI18n } from "../hooks/useI18n";
import { monthDateRange, shiftMonth } from "../lib/financeReports";
import { currentYearMonth, formatCurrency, formatMonthTitle } from "../lib/utils";

function StatCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-lg border border-ink-100 bg-ink-50 p-3">
      <p className="text-[10px] uppercase tracking-wider text-ink-500 font-semibold">{label}</p>
      <p className={`text-lg font-semibold mt-1 ${highlight ? "text-garnet-600" : "text-ink-900"}`}>{value}</p>
    </div>
  );
}

export default function FinanceRentalAccrualsPage() {
  const { t, locale } = useI18n();
  const [yearMonth, setYearMonth] = useState(currentYearMonth());
  const range = monthDateRange(yearMonth);
  const reportQuery = useRentalAccrualReport(range.dateFrom, range.dateTo);

  const report = reportQuery.data;
  const isCurrentMonth = yearMonth === currentYearMonth();

  const paidBreakdown = useMemo(() => {
    if (!report) return null;
    return [
      { label: t("rentalAccrual.paidDirect"), value: report.paidDirect },
      { label: t("rentalAccrual.paidInvoice"), value: report.paidInvoice },
    ];
  }, [report, t]);

  if (reportQuery.isLoading) {
    return <LoadingState label={t("rentalAccrual.loading")} />;
  }
  if (reportQuery.isError || !report) {
    return <QueryErrorState error={reportQuery.error} />;
  }

  return (
    <div className="panel-page-stack">
      <div className="bg-white rounded-xl border border-ink-200 shadow-xs overflow-hidden">
        <div className="px-4 py-3 border-b border-ink-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <FileBarChart className="w-4 h-4 text-gold-500" />
            <h2 className="font-sans text-sm font-semibold text-ink-800">{t("rentalAccrual.title")}</h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setYearMonth((m) => shiftMonth(m, -1))}
              className="p-1.5 rounded-lg border border-ink-200 text-ink-500 hover:bg-ink-50 cursor-pointer"
              aria-label={t("subscriptions.aria.prevMonth")}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-semibold text-ink-700 min-w-[8rem] text-center">
              {formatMonthTitle(yearMonth, locale)}
            </span>
            <button
              type="button"
              onClick={() => setYearMonth((m) => shiftMonth(m, 1))}
              disabled={isCurrentMonth}
              className="p-1.5 rounded-lg border border-ink-200 text-ink-500 hover:bg-ink-50 cursor-pointer disabled:opacity-40"
              aria-label={t("subscriptions.aria.nextMonth")}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-xs text-ink-500">{t("rentalAccrual.hint")}</p>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <StatCard label={t("rentalAccrual.accrued")} value={formatCurrency(report.accruedAmount)} />
            <StatCard label={t("rentalAccrual.paidTotal")} value={formatCurrency(report.paidTotal)} />
            <StatCard label={t("rentalAccrual.advancesReceived")} value={formatCurrency(report.advancesReceived)} />
            <StatCard label={t("rentalAccrual.advancesAllocated")} value={formatCurrency(report.advancesAllocated)} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <StatCard label={t("rentalAccrual.invoiceDebt")} value={formatCurrency(report.invoiceDebt)} highlight={report.invoiceDebt > 0} />
            <StatCard label={t("rentalAccrual.uninvoicedDebt")} value={formatCurrency(report.uninvoicedDebt)} highlight={report.uninvoicedDebt > 0} />
            <StatCard label={t("rentalAccrual.totalDebt")} value={formatCurrency(report.totalDebt)} highlight={report.totalDebt > 0} />
          </div>

          {paidBreakdown ? (
            <div className="rounded-lg border border-ink-100 p-3">
              <p className="text-[10px] uppercase tracking-wider text-ink-500 font-semibold mb-2">{t("rentalAccrual.paidBreakdown")}</p>
              <ul className="text-sm space-y-1">
                {paidBreakdown.map((row) => (
                  <li key={row.label} className="flex justify-between text-ink-700">
                    <span>{row.label}</span>
                    <span className="font-semibold">{formatCurrency(row.value)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
