import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import {
  TrendingUp,
  AlertCircle,
  Landmark,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
} from "lucide-react";
import {
  aggregatePaymentStats,
  monthDateRange,
  shiftMonth,
  sumDebtorAmounts,
} from "../lib/financeReports";
import {
  currentYearMonth,
  formatCurrency,
  formatMonthTitleRu,
} from "../lib/utils";
import { useFinancialDebtors } from "../hooks/useFinancialDebtors";
import { usePayments, PAYMENT_METHOD_LABELS } from "../hooks/usePayments";

export default function FinancialDashboard() {
  const navigate = useNavigate();
  const [statsMonth, setStatsMonth] = useState(currentYearMonth());
  const isViewingCurrentMonth = statsMonth === currentYearMonth();
  const range = monthDateRange(statsMonth);

  const paymentsQuery = usePayments({ dateFrom: range.dateFrom, dateTo: range.dateTo });
  const debtorsQuery = useFinancialDebtors();

  const stats = useMemo(
    () => aggregatePaymentStats(paymentsQuery.data ?? []),
    [paymentsQuery.data]
  );

  const debtors = debtorsQuery.data ?? [];
  const totalDebt = sumDebtorAmounts(debtors);
  const lowBalanceCount = debtors.filter((d) => d.kind === "subscription").length;
  const unpaidPersonalCount = debtors.filter((d) => d.kind === "personal").length;

  return (
    <div id="panel-dashboard" className="panel-page-stack">
      <div className="bg-white rounded-xl p-3.5 border border-slate-200/90 shadow-xs space-y-3">
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
          <h2 className="font-sans text-sm font-semibold text-slate-800 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-indigo-500" />
            Финансовый обзор
          </h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setStatsMonth((m) => shiftMonth(m, -1))}
              className="p-1 rounded-lg hover:bg-slate-50 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
              aria-label="Предыдущий месяц"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex flex-col items-center min-w-0">
              <span className="text-xs font-semibold text-slate-800">{formatMonthTitleRu(statsMonth)}</span>
              {!isViewingCurrentMonth && (
                <button
                  type="button"
                  onClick={() => setStatsMonth(currentYearMonth())}
                  className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-700 hover:underline cursor-pointer whitespace-nowrap"
                >
                  Текущий месяц
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setStatsMonth((m) => shiftMonth(m, 1))}
              className="p-1 rounded-lg hover:bg-slate-50 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
              aria-label="Следующий месяц"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-100">
            <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">Выручка</p>
            <p className="text-xl font-semibold text-slate-900 mt-0.5">{formatCurrency(stats.total)}</p>
            <p className="text-[10px] text-slate-500 mt-0.5">{stats.count} платежей</p>
          </div>
          <div className="bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-100">
            <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">Абонементы</p>
            <p className="text-xl font-semibold text-indigo-700 mt-0.5">{formatCurrency(stats.subscriptionTotal)}</p>
          </div>
          <div className="bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-100">
            <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">Персональные</p>
            <p className="text-xl font-semibold text-indigo-700 mt-0.5">{formatCurrency(stats.personalTotal)}</p>
          </div>
          <div className="bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-100">
            <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">Дебиторка</p>
            <p className="text-xl font-semibold text-rose-700 mt-0.5">{formatCurrency(totalDebt)}</p>
            <p className="text-[10px] text-slate-500 mt-0.5">
              {lowBalanceCount} абон. · {unpaidPersonalCount} перс.
            </p>
          </div>
        </div>

        {Object.keys(stats.byMethod).length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {Object.entries(stats.byMethod).map(([method, amount]) => (
              <div
                key={method}
                className="flex items-center justify-between px-3 py-2 rounded-lg border border-slate-100 text-xs font-sans"
              >
                <span className="text-slate-500">
                  {PAYMENT_METHOD_LABELS[method as keyof typeof PAYMENT_METHOD_LABELS] ?? method}
                </span>
                <span className="font-semibold text-slate-800">{formatCurrency(amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <motion.button
          type="button"
          whileHover={{ y: -2 }}
          onClick={() => navigate("/finance/revenue")}
          className="bg-white rounded-xl px-3 py-3 border border-slate-200/90 shadow-xs text-left hover:shadow-sm transition-all cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <TrendingUp className="w-4 h-4 text-indigo-500" />
            <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <p className="text-xs font-semibold text-slate-800 mt-2">Выручка</p>
          <p className="text-[10px] text-slate-500 mt-0.5">Детализация по месяцам</p>
        </motion.button>

        <motion.button
          type="button"
          whileHover={{ y: -2 }}
          onClick={() => navigate("/finance/debtors")}
          className="bg-white rounded-xl px-3 py-3 border border-slate-200/90 shadow-xs text-left hover:shadow-sm transition-all cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <AlertCircle className="w-4 h-4 text-rose-600" />
            <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <p className="text-xs font-semibold text-slate-800 mt-2">Дебиторы</p>
          <p className="text-[10px] text-slate-500 mt-0.5">{debtors.length} записей</p>
        </motion.button>

        <motion.button
          type="button"
          whileHover={{ y: -2 }}
          onClick={() => navigate("/finance/payments")}
          className="bg-white rounded-xl px-3 py-3 border border-slate-200/90 shadow-xs text-left hover:shadow-sm transition-all cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <Landmark className="w-4 h-4 text-indigo-500" />
            <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <p className="text-xs font-semibold text-slate-800 mt-2">Журнал платежей</p>
          <p className="text-[10px] text-slate-500 mt-0.5">Полная история</p>
        </motion.button>
      </div>
    </div>
  );
}
