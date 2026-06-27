import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, TrendingUp } from "lucide-react";
import LoadingState from "../components/ui/LoadingState";
import QueryErrorState from "../components/ui/QueryErrorState";
import { usePayments, getPaymentMethodLabel } from "../hooks/usePayments";
import type { PaymentMethod } from "../types";
import { useI18n } from "../hooks/useI18n";
import {
  aggregatePaymentStats,
  monthDateRange,
  shiftMonth,
} from "../lib/financeReports";
import { currentYearMonth, formatCurrency, formatMonthTitle } from "../lib/utils";

export default function FinanceRevenuePage() {
  const { t, locale, plural } = useI18n();
  const [yearMonth, setYearMonth] = useState(currentYearMonth());
  const range = monthDateRange(yearMonth);
  const paymentsQuery = usePayments({ dateFrom: range.dateFrom, dateTo: range.dateTo });

  const stats = useMemo(
    () => aggregatePaymentStats(paymentsQuery.data ?? []),
    [paymentsQuery.data]
  );

  if (paymentsQuery.isLoading) return <LoadingState label={t("finance.revenue.loading")} />;
  if (paymentsQuery.isError) return <QueryErrorState error={paymentsQuery.error} />;

  const isCurrentMonth = yearMonth === currentYearMonth();

  return (
    <div className="panel-page-stack">
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-indigo-500" />
            <h2 className="font-sans text-sm font-semibold text-slate-800">{t("finance.revenue.title")}</h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setYearMonth((m) => shiftMonth(m, -1))}
              className="p-1 rounded-lg hover:bg-slate-50 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
              aria-label={t("subscriptions.aria.prevMonth")}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex flex-col items-center min-w-[8rem]">
              <span className="text-xs font-semibold text-slate-800">{formatMonthTitle(yearMonth, locale)}</span>
              {!isCurrentMonth && (
                <button
                  type="button"
                  onClick={() => setYearMonth(currentYearMonth())}
                  className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-700 hover:underline cursor-pointer"
                >
                  {t("common.currentMonth")}
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setYearMonth((m) => shiftMonth(m, 1))}
              className="p-1 rounded-lg hover:bg-slate-50 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
              aria-label={t("subscriptions.aria.nextMonth")}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-100">
              <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">{t("finance.revenue.total")}</p>
              <p className="text-lg font-semibold text-slate-900 mt-0.5">{formatCurrency(stats.total)}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">
                {stats.count}{" "}
                {plural(stats.count, [t("common.payment.one"), t("common.payment.few"), t("common.payment.many")])}
              </p>
            </div>
            <div className="bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-100">
              <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">{t("dashboard.subscriptions")}</p>
              <p className="text-lg font-semibold text-indigo-700 mt-0.5">{formatCurrency(stats.subscriptionTotal)}</p>
            </div>
            <div className="bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-100">
              <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">{t("dashboard.personal")}</p>
              <p className="text-lg font-semibold text-indigo-700 mt-0.5">{formatCurrency(stats.personalTotal)}</p>
            </div>
            <div className="bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-100">
              <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">{t("finance.revenue.other")}</p>
              <p className="text-lg font-semibold text-slate-800 mt-0.5">{formatCurrency(stats.otherTotal)}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">{t("common.inDevelopment")}</p>
            </div>
          </div>

          {Object.keys(stats.byMethod).length > 0 && (
            <div>
              <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider mb-2">{t("finance.revenue.byMethod")}</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {Object.entries(stats.byMethod).map(([method, amount]) => (
                  <div
                    key={method}
                    className="flex items-center justify-between px-3 py-2 bg-white rounded-lg border border-slate-100 text-sm font-sans"
                  >
                    <span className="text-slate-600">
                      {getPaymentMethodLabel(method as PaymentMethod, t) ?? method}
                    </span>
                    <span className="font-semibold text-slate-800">{formatCurrency(amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {stats.count === 0 && (
            <div className="py-12 text-center">
              <TrendingUp className="w-8 h-8 text-slate-300 mx-auto mb-3" />
              <p className="text-sm text-slate-500">{t("finance.revenue.empty")}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
