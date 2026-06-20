import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, TrendingUp } from "lucide-react";
import LoadingState from "../components/ui/LoadingState";
import QueryErrorState from "../components/ui/QueryErrorState";
import { usePayments, PAYMENT_METHOD_LABELS } from "../hooks/usePayments";
import {
  aggregatePaymentStats,
  monthDateRange,
  shiftMonth,
} from "../lib/financeReports";
import { currentYearMonth, formatCurrency, formatMonthTitleRu } from "../lib/utils";

export default function FinanceRevenuePage() {
  const [yearMonth, setYearMonth] = useState(currentYearMonth());
  const range = monthDateRange(yearMonth);
  const paymentsQuery = usePayments({ dateFrom: range.dateFrom, dateTo: range.dateTo });

  const stats = useMemo(
    () => aggregatePaymentStats(paymentsQuery.data ?? []),
    [paymentsQuery.data]
  );

  if (paymentsQuery.isLoading) return <LoadingState label="Загрузка выручки..." />;
  if (paymentsQuery.isError) return <QueryErrorState error={paymentsQuery.error} />;

  const isCurrentMonth = yearMonth === currentYearMonth();

  return (
    <div className="panel-page-stack">
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-indigo-500" />
            <h2 className="font-sans text-sm font-semibold text-slate-800">Выручка</h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setYearMonth((m) => shiftMonth(m, -1))}
              className="p-1 rounded-lg hover:bg-slate-50 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
              aria-label="Предыдущий месяц"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex flex-col items-center min-w-[8rem]">
              <span className="text-xs font-semibold text-slate-800">{formatMonthTitleRu(yearMonth)}</span>
              {!isCurrentMonth && (
                <button
                  type="button"
                  onClick={() => setYearMonth(currentYearMonth())}
                  className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-700 hover:underline cursor-pointer"
                >
                  Текущий месяц
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setYearMonth((m) => shiftMonth(m, 1))}
              className="p-1 rounded-lg hover:bg-slate-50 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
              aria-label="Следующий месяц"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-100">
              <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">Итого</p>
              <p className="text-lg font-semibold text-slate-900 mt-0.5">{formatCurrency(stats.total)}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">{stats.count} платежей</p>
            </div>
            <div className="bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-100">
              <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">Абонементы</p>
              <p className="text-lg font-semibold text-indigo-700 mt-0.5">{formatCurrency(stats.subscriptionTotal)}</p>
            </div>
            <div className="bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-100">
              <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">Персональные</p>
              <p className="text-lg font-semibold text-indigo-700 mt-0.5">{formatCurrency(stats.personalTotal)}</p>
            </div>
            <div className="bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-100">
              <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">Прочее</p>
              <p className="text-lg font-semibold text-slate-800 mt-0.5">{formatCurrency(stats.otherTotal)}</p>
            </div>
          </div>

          {Object.keys(stats.byMethod).length > 0 && (
            <div>
              <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider mb-2">По способу оплаты</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {Object.entries(stats.byMethod).map(([method, amount]) => (
                  <div
                    key={method}
                    className="flex items-center justify-between px-3 py-2 bg-white rounded-lg border border-slate-100 text-sm font-sans"
                  >
                    <span className="text-slate-600">
                      {PAYMENT_METHOD_LABELS[method as keyof typeof PAYMENT_METHOD_LABELS] ?? method}
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
              <p className="text-sm text-slate-500">За этот период платежей нет</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
