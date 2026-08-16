import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, TrendingUp, Clock3 } from "lucide-react";
import LoadingState from "../components/ui/LoadingState";
import QueryErrorState from "../components/ui/QueryErrorState";
import FinanceMonthExportButton from "../components/finance/FinanceMonthExportButton";
import { usePayments, getPaymentMethodLabel } from "../hooks/usePayments";
import {
  useCompleteSubscriptionRefund,
  useSubscriptionRefunds,
} from "../hooks/useSubscriptionRefunds";
import { useOtherIncome } from "../hooks/useOtherIncome";
import { useRentalPayments } from "../hooks/useRentalPayments";
import type { PaymentMethod } from "../types";
import { useI18n } from "../hooks/useI18n";
import {
  aggregatePersonalTariffSales,
  buildExtendedRevenueStats,
  formatPersonalTariffSalesRowLabel,
  monthDateRange,
  refundsInMonth,
  shiftMonth,
} from "../lib/financeReports";
import { currentYearMonth, formatCurrency, formatMonthTitle } from "../lib/utils";
import { isFutureYearMonth, readFinanceMonthFromSearch } from "../lib/financeMonthUrl";
import { useToast } from "../App";
import { resolveMutationError } from "../lib/resolveMutationError";
import { btnAddCls } from "../components/ui/buttonStyles";

export default function FinanceRevenuePage() {
  const { t, locale, plural, formatDate } = useI18n();
  const toast = useToast();
  const completeRefund = useCompleteSubscriptionRefund();
  const [searchParams] = useSearchParams();
  const [yearMonth, setYearMonth] = useState(
    () => readFinanceMonthFromSearch(searchParams) ?? currentYearMonth()
  );
  const canGoNextMonth = !isFutureYearMonth(shiftMonth(yearMonth, 1));
  const range = monthDateRange(yearMonth);
  const paymentsQuery = usePayments({ dateFrom: range.dateFrom, dateTo: range.dateTo });
  const refundsQuery = useSubscriptionRefunds();
  const otherIncomeQuery = useOtherIncome({ dateFrom: range.dateFrom, dateTo: range.dateTo });
  const rentalPaymentsQuery = useRentalPayments({ dateFrom: range.dateFrom, dateTo: range.dateTo });

  const stats = useMemo(() => {
    const monthPayments = paymentsQuery.data ?? [];
    const monthRefunds = refundsInMonth(refundsQuery.data ?? [], yearMonth);
    const otherFromTable = (otherIncomeQuery.data ?? []).reduce((sum, row) => sum + row.amount, 0);
    return buildExtendedRevenueStats(monthPayments, monthRefunds, {
      otherIncomeAmount: otherFromTable,
      rentalRegisterEntries: rentalPaymentsQuery.data ?? [],
    });
  }, [paymentsQuery.data, refundsQuery.data, otherIncomeQuery.data, rentalPaymentsQuery.data, yearMonth]);

  const personalTariffRows = useMemo(
    () => aggregatePersonalTariffSales(paymentsQuery.data ?? []),
    [paymentsQuery.data]
  );

  const pendingRefunds = useMemo(
    () => (refundsQuery.data ?? []).filter((refund) => refund.status === "pending"),
    [refundsQuery.data]
  );

  const pendingTotal = pendingRefunds.reduce((sum, refund) => sum + refund.amount, 0);

  const handleCompletePending = async (refundId: string, amount: number) => {
    if (!window.confirm(t("subscriptions.refund.completeConfirm", { amount: formatCurrency(amount) }))) return;
    const res = await completeRefund.mutateAsync({ refundId });
    if (!res.success) {
      toast(resolveMutationError(res.error, "subscriptions.refund.error.completeFailed", t), "error");
      return;
    }
    toast(t("subscriptions.refund.completeSuccess", { amount: formatCurrency(res.amount) }), "success");
  };

  if (paymentsQuery.isLoading || otherIncomeQuery.isLoading || rentalPaymentsQuery.isLoading || refundsQuery.isLoading) {
    return <LoadingState label={t("finance.revenue.loading")} />;
  }
  if (paymentsQuery.isError || otherIncomeQuery.isError || rentalPaymentsQuery.isError || refundsQuery.isError) {
    return <QueryErrorState error={paymentsQuery.error ?? otherIncomeQuery.error ?? rentalPaymentsQuery.error ?? refundsQuery.error} />;
  }

  const isCurrentMonth = yearMonth === currentYearMonth();

  return (
    <div className="panel-page-stack">
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-indigo-500" />
            <h2 className="font-sans text-sm font-semibold text-slate-800">{t("finance.revenue.title")}</h2>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <FinanceMonthExportButton yearMonth={yearMonth} />
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
              disabled={!canGoNextMonth}
              className="p-1 rounded-lg hover:bg-slate-50 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label={t("subscriptions.aria.nextMonth")}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            </div>
          </div>
        </div>

        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            <div className="bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-100">
              <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">{t("finance.revenue.net")}</p>
              <p className="text-lg font-semibold text-slate-900 mt-0.5">{formatCurrency(stats.netTotal)}</p>
            </div>
            <div className="bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-100">
              <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">{t("finance.revenue.gross")}</p>
              <p className="text-lg font-semibold text-slate-800 mt-0.5">{formatCurrency(stats.grossTotal)}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">
                {stats.count}{" "}
                {plural(stats.count, [t("common.payment.one"), t("common.payment.few"), t("common.payment.many")])}
              </p>
            </div>
            <div className="bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-100">
              <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">{t("finance.revenue.refunds")}</p>
              <p className="text-lg font-semibold text-rose-700 mt-0.5">−{formatCurrency(stats.refundsTotal)}</p>
              {stats.refundCount > 0 ? (
                <p className="text-[10px] text-slate-500 mt-0.5">{stats.refundCount}</p>
              ) : null}
            </div>
            <div className="bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-100">
              <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">{t("finance.revenue.pendingRefunds")}</p>
              <p className="text-lg font-semibold text-amber-700 mt-0.5">{formatCurrency(pendingTotal)}</p>
              {pendingRefunds.length > 0 ? (
                <p className="text-[10px] text-slate-500 mt-0.5">{pendingRefunds.length}</p>
              ) : null}
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
              <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">{t("dashboard.singleVisits")}</p>
              <p className="text-lg font-semibold text-indigo-700 mt-0.5">{formatCurrency(stats.singleVisitTotal)}</p>
            </div>
            <div className="bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-100">
              <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">{t("finance.revenue.other")}</p>
              <p className="text-lg font-semibold text-slate-800 mt-0.5">{formatCurrency(stats.otherTotal)}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">{t("schedule.event.financeSection")}</p>
            </div>
            <div className="bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-100">
              <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">{t("finance.revenue.rental")}</p>
              <p className="text-lg font-semibold text-amber-700 mt-0.5">{formatCurrency(stats.rentalTotal)}</p>
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

      {personalTariffRows.length > 0 ? (
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="font-sans text-sm font-semibold text-slate-800">
              {t("finance.revenue.personalTariffs.title")}
            </h3>
          </div>
          <div className="hidden sm:grid sm:grid-cols-[minmax(0,1.4fr)_auto_auto] gap-3 px-4 py-2 bg-slate-50 border-b border-slate-100 text-[10px] uppercase tracking-wider font-semibold text-slate-400 font-sans">
            <span>{t("finance.revenue.personalTariffs.tariffColumn")}</span>
            <span className="text-right">{t("finance.revenue.personalTariffs.countColumn")}</span>
            <span className="text-right min-w-[6rem]">{t("finance.revenue.personalTariffs.sumColumn")}</span>
          </div>
          <ul className="divide-y divide-slate-100">
            {personalTariffRows.map((row) => (
              <li
                key={row.rowKey}
                className="px-4 py-3 grid grid-cols-1 sm:grid-cols-[minmax(0,1.4fr)_auto_auto] gap-1 sm:gap-3 sm:items-center text-sm font-sans"
              >
                <span className="font-semibold text-slate-800">
                  {formatPersonalTariffSalesRowLabel(row, t)}
                </span>
                <span className="text-slate-600 sm:text-right">
                  <span className="sm:hidden text-[10px] uppercase tracking-wider text-slate-400 font-semibold mr-2">
                    {t("finance.revenue.personalTariffs.countColumn")}
                  </span>
                  {row.countPaymentsNet}
                </span>
                <span className="font-semibold text-slate-800 sm:text-right min-w-[6rem]">
                  <span className="sm:hidden text-[10px] uppercase tracking-wider text-slate-400 font-semibold mr-2">
                    {t("finance.revenue.personalTariffs.sumColumn")}
                  </span>
                  {formatCurrency(row.sumNet)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {pendingRefunds.length > 0 ? (
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
            <Clock3 className="w-4 h-4 text-amber-600" />
            <h3 className="font-sans text-sm font-semibold text-slate-800">{t("finance.revenue.pendingRefundsTitle")}</h3>
          </div>
          <ul className="divide-y divide-slate-100">
            {pendingRefunds.map((refund) => (
              <li key={refund.id} className="px-4 py-3 flex items-center justify-between gap-3 text-sm">
                <div>
                  <p className="font-semibold text-slate-800">{formatCurrency(refund.amount)}</p>
                  <p className="text-xs text-slate-500">
                    {formatDate(refund.operationDate)}
                    {" · "}
                    {t(`subscriptions.refund.kind.${refund.refundKind}`)}
                    {" · "}
                    {getPaymentMethodLabel(refund.method, t)}
                  </p>
                  {refund.reason ? <p className="text-xs text-slate-500 italic mt-0.5">{refund.reason}</p> : null}
                </div>
                <button
                  type="button"
                  onClick={() => void handleCompletePending(refund.id, refund.amount)}
                  disabled={completeRefund.isPending}
                  className={`shrink-0 ${btnAddCls}`}
                >
                  {t("subscriptions.refund.completeAction")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
