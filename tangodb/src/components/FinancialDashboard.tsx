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
  ArrowDown,
  ArrowUp,
} from "lucide-react";
import {
  aggregatePaymentStats,
  aggregatePaymentsByMonth,
  buildMonthSeries,
  buildRevenueSplit,
  computeMomChangePercent,
  formatMomPercent,
  paymentsInMonth,
  shiftMonth,
  sumDebtorAmounts,
  type MonthlyRevenuePoint,
  type RevenueSplitKey,
  type RevenueSplitSegment,
} from "../lib/financeReports";
import {
  currentYearMonth,
  formatCurrency,
  formatMonthTitle,
} from "../lib/utils";
import { useI18n } from "../hooks/useI18n";
import { useFinancialDebtors } from "../hooks/useFinancialDebtors";
import { usePayments, usePaymentsTrend, PAYMENT_METHOD_LABELS } from "../hooks/usePayments";

const SPLIT_COLORS: Record<RevenueSplitKey, string> = {
  subscription: "bg-indigo-500",
  personal: "bg-violet-500",
  other: "bg-slate-400",
};

function formatShortMonth(yearMonth: string, locale: string | null): string {
  const [y, m] = yearMonth.split("-").map(Number);
  if (!y || !m) return yearMonth;
  return new Intl.DateTimeFormat(locale ?? "ru-RU", { month: "short" }).format(new Date(y, m - 1, 1));
}

function RevenueTrendChart({
  points,
  locale,
}: {
  points: MonthlyRevenuePoint[];
  locale: string | null;
}) {
  const maxTotal = Math.max(...points.map((point) => point.total), 1);
  const width = 320;
  const height = 88;
  const padX = 8;
  const padY = 8;
  const chartW = width - padX * 2;
  const chartH = height - padY * 2;

  const coords = points.map((point, index) => {
    const x = padX + (index / Math.max(points.length - 1, 1)) * chartW;
    const y = padY + chartH - (point.total / maxTotal) * chartH;
    return { ...point, x, y };
  });

  const linePath = coords.map((point) => `${point.x},${point.y}`).join(" ");
  const areaPath = [
    `M ${coords[0]?.x ?? padX} ${padY + chartH}`,
    ...coords.map((point) => `L ${point.x} ${point.y}`),
    `L ${coords[coords.length - 1]?.x ?? padX + chartW} ${padY + chartH}`,
    "Z",
  ].join(" ");

  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-24" role="img" aria-hidden>
        <defs>
          <linearGradient id="revenueTrendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(99 102 241)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="rgb(99 102 241)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#revenueTrendFill)" />
        <polyline
          fill="none"
          stroke="rgb(79 70 229)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={linePath}
        />
        {coords.map((point) => (
          <circle
            key={point.month}
            cx={point.x}
            cy={point.y}
            r={point.total > 0 ? 3 : 2}
            fill={point.total > 0 ? "rgb(79 70 229)" : "rgb(203 213 225)"}
          />
        ))}
      </svg>
      <div className="grid grid-cols-6 gap-1">
        {coords.map((point) => (
          <div key={point.month} className="text-center min-w-0">
            <p className="text-[9px] text-slate-400 truncate">{formatShortMonth(point.month, locale)}</p>
            <p className="text-[10px] font-semibold text-slate-700 truncate">{formatCurrency(point.total)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function RevenueSplitChart({
  segments,
  labelForKey,
}: {
  segments: RevenueSplitSegment[];
  labelForKey: (key: RevenueSplitKey) => string;
}) {
  if (segments.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
        {segments.map((segment) => (
          <div
            key={segment.key}
            className={`${SPLIT_COLORS[segment.key]} transition-all`}
            style={{ width: `${segment.percent}%` }}
            title={`${labelForKey(segment.key)}: ${segment.percent.toFixed(1)}%`}
          />
        ))}
      </div>
      <div className="space-y-2">
        {segments.map((segment) => (
          <div key={segment.key} className="flex items-center justify-between gap-2 text-xs font-sans">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`w-2 h-2 rounded-full shrink-0 ${SPLIT_COLORS[segment.key]}`} />
              <span className="text-slate-600 truncate">{labelForKey(segment.key)}</span>
            </div>
            <div className="text-right shrink-0">
              <span className="font-semibold text-slate-800">{formatCurrency(segment.amount)}</span>
              <span className="text-slate-400 ml-1.5">{segment.percent.toFixed(0)}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function FinancialDashboard() {
  const navigate = useNavigate();
  const { t, locale, plural } = useI18n();
  const [statsMonth, setStatsMonth] = useState(currentYearMonth());
  const isViewingCurrentMonth = statsMonth === currentYearMonth();

  const paymentsQuery = usePaymentsTrend(statsMonth);
  const debtorsQuery = useFinancialDebtors();

  const monthSeries = useMemo(() => buildMonthSeries(statsMonth), [statsMonth]);
  const trendPoints = useMemo(
    () => aggregatePaymentsByMonth(paymentsQuery.data ?? [], monthSeries),
    [paymentsQuery.data, monthSeries]
  );

  const stats = useMemo(() => {
    const monthPayments = paymentsInMonth(paymentsQuery.data ?? [], statsMonth);
    return aggregatePaymentStats(monthPayments);
  }, [paymentsQuery.data, statsMonth]);

  const momPercent = useMemo(() => {
    const previousMonth = shiftMonth(statsMonth, -1);
    const previousTotal =
      trendPoints.find((point) => point.month === previousMonth)?.total ?? 0;
    return computeMomChangePercent(stats.total, previousTotal);
  }, [stats.total, statsMonth, trendPoints]);

  const revenueSplit = useMemo(() => buildRevenueSplit(stats), [stats]);

  const splitLabel = (key: RevenueSplitKey) => {
    if (key === "subscription") return t("dashboard.subscriptions");
    if (key === "personal") return t("dashboard.personal");
    return t("finance.revenue.other");
  };

  const debtors = debtorsQuery.data ?? [];
  const totalDebt = sumDebtorAmounts(debtors);
  const lowBalanceCount = debtors.filter((d) => d.kind === "subscription").length;
  const unpaidPersonalCount = debtors.filter((d) => d.kind === "personal").length;

  const momPositive = momPercent !== null && momPercent > 0;
  const momNegative = momPercent !== null && momPercent < 0;

  return (
    <div id="panel-dashboard" className="panel-page-stack">
      <div className="bg-white rounded-xl p-3.5 border border-slate-200/90 shadow-xs space-y-3">
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
          <h2 className="font-sans text-sm font-semibold text-slate-800 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-indigo-500" />
            {t("dashboard.financialOverview")}
          </h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setStatsMonth((m) => shiftMonth(m, -1))}
              className="p-1 rounded-lg hover:bg-slate-50 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
              aria-label={t("subscriptions.aria.prevMonth")}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex flex-col items-center min-w-0">
              <span className="text-xs font-semibold text-slate-800">{formatMonthTitle(statsMonth, locale)}</span>
              {!isViewingCurrentMonth && (
                <button
                  type="button"
                  onClick={() => setStatsMonth(currentYearMonth())}
                  className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-700 hover:underline cursor-pointer whitespace-nowrap"
                >
                  {t("common.currentMonth")}
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setStatsMonth((m) => shiftMonth(m, 1))}
              className="p-1 rounded-lg hover:bg-slate-50 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
              aria-label={t("subscriptions.aria.nextMonth")}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-100">
            <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">{t("dashboard.revenue")}</p>
            <p className="text-xl font-semibold text-slate-900 mt-0.5">{formatCurrency(stats.total)}</p>
            <div className="flex items-center gap-1 mt-0.5">
              {momPositive && <ArrowUp className="w-3 h-3 text-emerald-600" />}
              {momNegative && <ArrowDown className="w-3 h-3 text-rose-600" />}
              <p
                className={`text-[10px] font-semibold ${
                  momPositive ? "text-emerald-600" : momNegative ? "text-rose-600" : "text-slate-500"
                }`}
              >
                {momPercent === null ? t("dashboard.momUnavailable") : formatMomPercent(momPercent)}
              </p>
              {momPercent !== null && (
                <span className="text-[10px] text-slate-400">{t("dashboard.momVsPrevious")}</span>
              )}
            </div>
            <p className="text-[10px] text-slate-500 mt-0.5">
              {stats.count}{" "}
              {plural(stats.count, [t("common.payment.one"), t("common.payment.few"), t("common.payment.many")])}
            </p>
          </div>
          <div className="bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-100">
            <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">{t("dashboard.subscriptions")}</p>
            <p className="text-xl font-semibold text-indigo-700 mt-0.5">{formatCurrency(stats.subscriptionTotal)}</p>
          </div>
          <div className="bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-100">
            <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">{t("dashboard.personal")}</p>
            <p className="text-xl font-semibold text-indigo-700 mt-0.5">{formatCurrency(stats.personalTotal)}</p>
          </div>
          <div className="bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-100">
            <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">{t("dashboard.receivables")}</p>
            <p className="text-xl font-semibold text-rose-700 mt-0.5">{formatCurrency(totalDebt)}</p>
            <p className="text-[10px] text-slate-500 mt-0.5">
              {t("dashboard.receivablesBreakdown", { subs: lowBalanceCount, personal: unpaidPersonalCount })}
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

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 pt-1 border-t border-slate-100">
          <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-3 space-y-2">
            <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">
              {t("dashboard.revenueTrend")}
            </p>
            {paymentsQuery.isLoading ? (
              <p className="text-xs text-slate-500 py-8 text-center">{t("dashboard.loading")}</p>
            ) : (
              <RevenueTrendChart points={trendPoints} locale={locale} />
            )}
          </div>
          <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-3 space-y-2">
            <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">
              {t("dashboard.revenueSplit")}
            </p>
            {stats.total > 0 ? (
              <RevenueSplitChart segments={revenueSplit} labelForKey={splitLabel} />
            ) : (
              <p className="text-xs text-slate-500 py-8 text-center">{t("dashboard.noRevenueInMonth")}</p>
            )}
          </div>
        </div>
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
          <p className="text-xs font-semibold text-slate-800 mt-2">{t("dashboard.revenue")}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">{t("dashboard.revenueDetail")}</p>
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
          <p className="text-xs font-semibold text-slate-800 mt-2">{t("dashboard.debtors")}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">
            {debtors.length}{" "}
            {plural(debtors.length, [t("common.records.one", { count: debtors.length }), t("common.records.few", { count: debtors.length }), t("common.records.many", { count: debtors.length })])}
          </p>
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
          <p className="text-xs font-semibold text-slate-800 mt-2">{t("dashboard.paymentJournal")}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">{t("dashboard.fullHistory")}</p>
        </motion.button>
      </div>
    </div>
  );
}
