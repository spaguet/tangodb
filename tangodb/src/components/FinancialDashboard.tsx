import { useEffect, useId, useMemo, useRef, useState } from "react";
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
  UserPlus,
  Users,
  GraduationCap,
  ClipboardCheck,
  Loader2,
} from "lucide-react";
import {
  aggregatePaymentStats,
  aggregatePaymentsByDay,
  aggregatePaymentsByMonth,
  buildClassLocationMap,
  buildClassTeacherMap,
  buildDaySeries,
  buildMonthSeries,
  buildRevenueSplit,
  buildTopClientsByRevenue,
  buildTopTeachersByRevenue,
  buildExtendedRevenueStats,
  computeMomChangePercent,
  computeOccupancyStats,
  countNewClientsInMonth,
  refundsInMonth,
  formatMomPercent,
  formatOccupancyPercent,
  paymentsInMonth,
  revenueTrendMonthCount,
  shiftMonth,
  sumDebtorAmounts,
  monthDateRange,
  type MonthlyRevenuePoint,
  type RevenueRankEntry,
  type RevenueSplitKey,
  type RevenueSplitSegment,
  type RevenueTrendPeriod,
} from "../lib/financeReports";
import {
  currentYearMonth,
  formatCurrency,
  formatMonthTitle,
} from "../lib/utils";
import { useI18n } from "../hooks/useI18n";
import { useAttendanceRecords } from "../hooks/useAttendance";
import { useClients } from "../hooks/useClients";
import { useFinancialDebtors } from "../hooks/useFinancialDebtors";
import { usePersonalLessons } from "../hooks/usePersonalLessons";
import { usePaymentsTrend, getPaymentMethodLabel } from "../hooks/usePayments";
import { useSubscriptionRefunds } from "../hooks/useSubscriptionRefunds";
import type { PaymentMethod } from "../types";
import { sumExpenses, useExpensesForMonth } from "../hooks/useExpenses";
import { useFinanceCosts, useRecalculatePendingVenueCosts } from "../hooks/useVenueCosts";
import { useOtherIncome } from "../hooks/useOtherIncome";
import { useRentalPayments } from "../hooks/useRentalPayments";
import { usePermissions } from "../hooks/usePermissions";
import { usePersonalLessonsModuleEnabled } from "../hooks/useOrgModules";
import { useRecalculateTeacherSettlement, useTeacherSettlements } from "../hooks/usePayroll";
import { useSchedule } from "../hooks/useSchedule";
import { useSubscriptionGroups } from "../hooks/useSubscriptionGroups";
import { useSubscriptions } from "../hooks/useSubscriptions";
import { memberListLabel, useTeamMembers } from "../hooks/useTeamMembers";
import { useSingleVisits } from "../hooks/useSingleVisits";
import AppSelect from "./ui/AppSelect";

const SPLIT_COLORS: Record<RevenueSplitKey, string> = {
  subscription: "bg-indigo-500",
  personal: "bg-indigo-700",
  single_visit: "bg-indigo-400",
  other: "bg-slate-400",
};

function formatShortMonth(yearMonth: string, locale: string | null): string {
  const [y, m] = yearMonth.split("-").map(Number);
  if (!y || !m) return yearMonth;
  return new Intl.DateTimeFormat(locale ?? "ru-RU", { month: "short" }).format(new Date(y, m - 1, 1));
}

function formatDayLabel(isoDay: string): string {
  const day = Number(isoDay.split("-")[2]);
  return Number.isFinite(day) ? String(day) : isoDay;
}

function formatTrendPointLabel(
  key: string,
  period: RevenueTrendPeriod,
  locale: string | null
): string {
  if (period === "month") return formatDayLabel(key);
  return formatShortMonth(key, locale);
}

function shouldShowTrendLabel(index: number, total: number): boolean {
  if (total <= 12) return true;
  if (total <= 31) return index % 5 === 0 || index === total - 1;
  const step = Math.ceil(total / 12);
  return index % step === 0 || index === total - 1;
}

/** Горизонтальный отступ графика — совпадает с px-3 у карточек метрик («Расходы за месяц» и др.) */
const TREND_CHART_PAD_X = 12;
const TREND_CHART_PLOT_TOP = 8;
const TREND_CHART_LABEL_ROW = 28;

function RevenueTrendChart({
  points,
  locale,
  period,
}: {
  points: MonthlyRevenuePoint[];
  locale: string | null;
  period: RevenueTrendPeriod;
}) {
  const gradientId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setContainerWidth(w);
    });
    ro.observe(el);
    setContainerWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  const maxTotal = Math.max(...points.map((point) => point.total), 1);
  const avgTotal =
    points.length > 0 ? points.reduce((sum, point) => sum + point.total, 0) / points.length : 0;

  const maxLabel = formatCurrency(maxTotal);
  const avgLabel = formatCurrency(Math.round(avgTotal));

  const width = Math.max(containerWidth, 1);
  const plotLeft = TREND_CHART_PAD_X;
  const plotRight = width - TREND_CHART_PAD_X;
  const plotW = Math.max(plotRight - plotLeft, 1);
  const plotHeight = 88;
  const chartBottom = TREND_CHART_PLOT_TOP + plotHeight;
  const svgHeight = chartBottom + TREND_CHART_LABEL_ROW;

  const coords = points.map((point, index) => {
    const x =
      plotLeft + (points.length <= 1 ? 0 : index / (points.length - 1)) * plotW;
    const y = TREND_CHART_PLOT_TOP + plotHeight - (point.total / maxTotal) * plotHeight;
    return { ...point, x, y };
  });

  const maxY = TREND_CHART_PLOT_TOP;
  const avgY = TREND_CHART_PLOT_TOP + plotHeight - (avgTotal / maxTotal) * plotHeight;

  const linePath = coords.map((point) => `${point.x},${point.y}`).join(" ");
  const areaPath = [
    `M ${coords[0]?.x ?? plotLeft} ${chartBottom}`,
    ...coords.map((point) => `L ${point.x} ${point.y}`),
    `L ${coords[coords.length - 1]?.x ?? plotRight} ${chartBottom}`,
    "Z",
  ].join(" ");

  const hovered = hoveredIndex !== null ? coords[hoveredIndex] : null;

  return (
    <div ref={containerRef} className="relative w-full">
      <svg
        width={width}
        height={svgHeight}
        className="block w-full"
        role="img"
        aria-label="Revenue trend"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(99 102 241)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="rgb(99 102 241)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        <line
          x1={plotLeft}
          y1={maxY}
          x2={plotRight}
          y2={maxY}
          stroke="rgb(203 213 225)"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
        <line
          x1={plotLeft}
          y1={avgY}
          x2={plotRight}
          y2={avgY}
          stroke="rgb(203 213 225)"
          strokeWidth="1"
          strokeDasharray="3 3"
        />

        <text
          x={plotLeft - 4}
          y={maxY + 3}
          textAnchor="end"
          className="fill-slate-400"
          fontSize="8"
        >
          {maxLabel}
        </text>
        <text
          x={plotLeft - 4}
          y={avgY + 3}
          textAnchor="end"
          className="fill-slate-400"
          fontSize="8"
        >
          {avgLabel}
        </text>

        <path d={areaPath} fill={`url(#${gradientId})`} />
        <polyline
          fill="none"
          stroke="rgb(79 70 229)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={linePath}
        />

        {coords.map((point, index) => {
          const prevX = index === 0 ? plotLeft : (coords[index - 1].x + point.x) / 2;
          const nextX =
            index === coords.length - 1 ? plotRight : (point.x + coords[index + 1].x) / 2;
          const isHovered = hoveredIndex === index;
          return (
            <g key={point.month}>
              <rect
                x={prevX}
                y={0}
                width={Math.max(nextX - prevX, 1)}
                height={chartBottom}
                fill="transparent"
                className="cursor-crosshair"
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
              />
              <circle
                cx={point.x}
                cy={point.y}
                r={isHovered ? 5 : point.total > 0 ? 3 : 2}
                fill={point.total > 0 ? "rgb(79 70 229)" : "rgb(203 213 225)"}
                stroke={isHovered ? "white" : "none"}
                strokeWidth={isHovered ? 2 : 0}
                pointerEvents="none"
              />
            </g>
          );
        })}

        {coords.map((point, index) => {
          if (!shouldShowTrendLabel(index, coords.length)) return null;
          return (
            <text
              key={`label-${point.month}`}
              x={point.x}
              y={chartBottom + 14}
              textAnchor="middle"
              className="fill-slate-400"
              fontSize="9"
            >
              {formatTrendPointLabel(point.month, period, locale)}
            </text>
          );
        })}
      </svg>

      {hovered && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-md border border-slate-200 bg-white px-2 py-1 shadow-sm"
          style={{
            left: (hovered.x / width) * 100 + "%",
            top: Math.max(hovered.y - 44, 0),
          }}
        >
          <p className="text-[10px] text-slate-500 whitespace-nowrap">
            {formatTrendPointLabel(hovered.month, period, locale)}
          </p>
          <p className="text-xs font-semibold text-slate-800 whitespace-nowrap">
            {formatCurrency(hovered.total)}
          </p>
        </div>
      )}
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

function DashboardStatValue({
  loading,
  children,
  className = "text-xl font-semibold mt-0.5",
}: {
  loading?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const { t } = useI18n();

  if (loading) {
    return (
      <p className={`${className} text-slate-400 flex items-center gap-1.5`}>
        <Loader2 className="w-4 h-4 animate-spin shrink-0 text-indigo-400" aria-hidden />
        <span>{t("common.loading.default")}</span>
      </p>
    );
  }

  return <p className={className}>{children}</p>;
}

function RevenueRankList({
  title,
  icon: Icon,
  entries,
  emptyLabel,
  loadingLabel,
  loading,
}: {
  title: string;
  icon: typeof Users;
  entries: RevenueRankEntry[];
  emptyLabel: string;
  loadingLabel: string;
  loading?: boolean;
}) {
  const maxAmount = Math.max(...entries.map((entry) => entry.amount), 1);

  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-3 space-y-2">
      <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5" />
        {title}
      </p>
      {loading ? (
        <p className="text-xs text-slate-500 py-6 text-center">{loadingLabel}</p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-slate-500 py-6 text-center">{emptyLabel}</p>
      ) : (
        <ol className="space-y-2">
          {entries.map((entry, index) => (
            <li key={entry.key} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-xs font-sans">
                <span className="text-slate-600 truncate min-w-0">
                  <span className="text-slate-400 mr-1.5">{index + 1}.</span>
                  {entry.label}
                </span>
                <span className="font-semibold text-slate-800 shrink-0">{formatCurrency(entry.amount)}</span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-indigo-500"
                  style={{ width: `${(entry.amount / maxAmount) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default function FinancialDashboard() {
  const navigate = useNavigate();
  const { t, locale, plural } = useI18n();
  const { can } = usePermissions();
  const personalLessonsEnabled = usePersonalLessonsModuleEnabled();
  const canWritePayroll = can("payroll.write");
  const canReadFinance = can("finance.read");
  const [statsMonth, setStatsMonth] = useState(currentYearMonth());
  const [trendPeriod, setTrendPeriod] = useState<RevenueTrendPeriod>("6months");
  const isViewingCurrentMonth = statsMonth === currentYearMonth();

  const trendFetchMonths = revenueTrendMonthCount(trendPeriod);
  const paymentsQuery = usePaymentsTrend(statsMonth, trendFetchMonths);
  const refundsQuery = useSubscriptionRefunds();
  const expensesQuery = useExpensesForMonth(statsMonth);
  const monthRange = useMemo(() => monthDateRange(statsMonth), [statsMonth]);
  const financeCostsQuery = useFinanceCosts(monthRange.dateFrom, monthRange.dateTo);
  const otherIncomeQuery = useOtherIncome({
    dateFrom: monthRange.dateFrom,
    dateTo: monthRange.dateTo,
  });
  const rentalPaymentsQuery = useRentalPayments({
    dateFrom: monthRange.dateFrom,
    dateTo: monthRange.dateTo,
  });
  const payrollQuery = useTeacherSettlements(statsMonth);
  const recalculatePayroll = useRecalculateTeacherSettlement();
  const recalculateVenueCosts = useRecalculatePendingVenueCosts();
  const debtorsQuery = useFinancialDebtors();
  const clientsQuery = useClients();
  const attendanceQuery = useAttendanceRecords(statsMonth);
  const personalLessonsQuery = usePersonalLessons({
    yearMonth: statsMonth,
    enabled: personalLessonsEnabled,
  });
  const scheduleQuery = useSchedule();
  const subscriptionGroupsQuery = useSubscriptionGroups();
  const subscriptionsQuery = useSubscriptions();
  const teamQuery = useTeamMembers();
  const singleVisitsQuery = useSingleVisits({ yearMonth: statsMonth });

  const financialStatsLoading =
    paymentsQuery.isLoading ||
    refundsQuery.isLoading ||
    otherIncomeQuery.isLoading ||
    rentalPaymentsQuery.isLoading;

  const receivablesLoading = debtorsQuery.isLoading;

  const expensesLoading =
    expensesQuery.isLoading ||
    (financeCostsQuery.isLoading && !financeCostsQuery.isError) ||
    recalculateVenueCosts.isPending;

  const profitLoading =
    financialStatsLoading ||
    expensesLoading ||
    payrollQuery.isLoading ||
    recalculatePayroll.isPending;

  const analyticsLoading =
    clientsQuery.isLoading ||
    attendanceQuery.isLoading ||
    (personalLessonsEnabled && personalLessonsQuery.isLoading) ||
    scheduleQuery.isLoading ||
    subscriptionGroupsQuery.isLoading ||
    teamQuery.isLoading ||
    singleVisitsQuery.isLoading;

  useEffect(() => {
    const queries = [
      paymentsQuery,
      expensesQuery,
      financeCostsQuery,
      otherIncomeQuery,
      rentalPaymentsQuery,
      payrollQuery,
      debtorsQuery,
      clientsQuery,
      attendanceQuery,
      scheduleQuery,
      subscriptionGroupsQuery,
      teamQuery,
      singleVisitsQuery,
      ...(personalLessonsEnabled ? [personalLessonsQuery] : []),
    ];
    void Promise.all(queries.map((query) => query.refetch()));
  }, []);

  const monthSeries = useMemo(() => {
    if (trendPeriod === "month") return buildDaySeries(statsMonth);
    return buildMonthSeries(statsMonth, trendFetchMonths);
  }, [statsMonth, trendPeriod, trendFetchMonths]);

  const trendPoints = useMemo(() => {
    const payments = paymentsQuery.data ?? [];
    if (trendPeriod === "month") {
      return aggregatePaymentsByDay(payments, monthSeries);
    }
    return aggregatePaymentsByMonth(payments, monthSeries);
  }, [paymentsQuery.data, monthSeries, trendPeriod]);

  const stats = useMemo(() => {
    const monthPayments = paymentsInMonth(paymentsQuery.data ?? [], statsMonth);
    const monthRefunds = refundsInMonth(refundsQuery.data ?? [], statsMonth);
    const otherFromTable = (otherIncomeQuery.data ?? []).reduce((sum, row) => sum + row.amount, 0);
    const allPending = (refundsQuery.data ?? []).filter((refund) => refund.status === "pending");
    const base = buildExtendedRevenueStats(monthPayments, monthRefunds, {
      otherIncomeAmount: otherFromTable,
      rentalRegisterEntries: rentalPaymentsQuery.data ?? [],
    });
    return {
      ...base,
      pendingRefundsTotal: allPending.reduce((sum, refund) => sum + refund.amount, 0),
      pendingRefundCount: allPending.length,
    };
  }, [
    paymentsQuery.data,
    refundsQuery.data,
    otherIncomeQuery.data,
    rentalPaymentsQuery.data,
    statsMonth,
  ]);

  const financeCostsUnavailable = financeCostsQuery.isError;
  const expensesTotal = useMemo(() => {
    if (financeCostsQuery.data) return financeCostsQuery.data.total;
    return sumExpenses(expensesQuery.data ?? []);
  }, [financeCostsQuery.data, expensesQuery.data]);
  const venueCostsTotal = financeCostsQuery.data?.venueTotal ?? 0;
  const manualExpensesTotal = financeCostsQuery.data?.manualTotal ?? sumExpenses(expensesQuery.data ?? []);

  useEffect(() => {
    if (!canWritePayroll) return;
    void recalculatePayroll.mutateAsync(statsMonth);
  }, [statsMonth, canWritePayroll]);

  useEffect(() => {
    if (!canReadFinance) return;
    void recalculateVenueCosts.mutateAsync({
      dateFrom: monthRange.dateFrom,
      dateTo: monthRange.dateTo,
    });
  }, [statsMonth, monthRange.dateFrom, monthRange.dateTo, canReadFinance]);

  const payrollAccrued = useMemo(
    () => (payrollQuery.data ?? []).reduce((sum, settlement) => sum + settlement.amountAccrued, 0),
    [payrollQuery.data]
  );

  const profit = stats.netTotal - expensesTotal - payrollAccrued;

  const momPercent = useMemo(() => {
    const previousMonth = shiftMonth(statsMonth, -1);
    const previousTotal =
      trendPoints.find((point) => point.month === previousMonth)?.total ?? 0;
    return computeMomChangePercent(stats.netTotal, previousTotal);
  }, [stats.netTotal, statsMonth, trendPoints]);

  const revenueSplit = useMemo(() => {
    const segments = buildRevenueSplit(stats);
    return personalLessonsEnabled ? segments : segments.filter((segment) => segment.key !== "personal");
  }, [stats, personalLessonsEnabled]);

  const monthPayments = useMemo(
    () => paymentsInMonth(paymentsQuery.data ?? [], statsMonth),
    [paymentsQuery.data, statsMonth]
  );

  const newClientsCount = useMemo(
    () => countNewClientsInMonth(clientsQuery.data ?? [], statsMonth),
    [clientsQuery.data, statsMonth]
  );

  const subscriptionTypesById = useMemo(
    () => Object.fromEntries((subscriptionsQuery.data ?? []).map((sub) => [sub.id, sub.type])),
    [subscriptionsQuery.data]
  );

  const occupancyStats = useMemo(
    () =>
      computeOccupancyStats(
        attendanceQuery.data ?? [],
        personalLessonsEnabled ? (personalLessonsQuery.data ?? []) : [],
        singleVisitsQuery.data ?? [],
        subscriptionTypesById
      ),
    [
      attendanceQuery.data,
      personalLessonsQuery.data,
      singleVisitsQuery.data,
      personalLessonsEnabled,
      subscriptionTypesById,
    ]
  );

  const topClients = useMemo(
    () => buildTopClientsByRevenue(monthPayments),
    [monthPayments]
  );

  const topTeachers = useMemo(() => {
    const teacherLabels = new Map(
      (teamQuery.data ?? []).map((member) => [member.id, memberListLabel(member, locale)])
    );
    const personalLessonById = new Map(
      personalLessonsEnabled
        ? (personalLessonsQuery.data ?? []).map((lesson) => [lesson.id, lesson])
        : []
    );
    const singleVisitById = new Map(
      (singleVisitsQuery.data ?? []).map((visit) => [visit.id, visit])
    );
    return buildTopTeachersByRevenue(monthPayments, {
      personalLessonById,
      singleVisitById,
      groupsBySubId: subscriptionGroupsQuery.groupsBySubId,
      classTeacherByGroupId: buildClassTeacherMap(scheduleQuery.data ?? []),
      classLocationByGroupId: buildClassLocationMap(scheduleQuery.data ?? []),
      teacherLabels,
    });
  }, [
    monthPayments,
    teamQuery.data,
    personalLessonsQuery.data,
    singleVisitsQuery.data,
    subscriptionGroupsQuery.groupsBySubId,
    scheduleQuery.data,
    locale,
    personalLessonsEnabled,
  ]);

  const splitLabel = (key: RevenueSplitKey) => {
    if (key === "subscription") return t("dashboard.subscriptions");
    if (key === "personal") return t("dashboard.personal");
    if (key === "single_visit") return t("dashboard.singleVisits");
    return t("finance.revenue.other");
  };

  const debtors = useMemo(
    () =>
      personalLessonsEnabled
        ? (debtorsQuery.data ?? [])
        : (debtorsQuery.data ?? []).filter((entry) => entry.kind !== "personal"),
    [debtorsQuery.data, personalLessonsEnabled]
  );
  const totalDebt = sumDebtorAmounts(debtors);
  const lowBalanceCount = debtors.filter((d) => d.kind === "subscription").length;
  const unpaidPersonalCount = personalLessonsEnabled
    ? debtors.filter((d) => d.kind === "personal").length
    : 0;

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

        <div className={`grid gap-3 ${personalLessonsEnabled ? "grid-cols-2 lg:grid-cols-5" : "grid-cols-2 lg:grid-cols-4"}`}>
          <div className="bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-100">
            <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">{t("dashboard.revenue")}</p>
            <DashboardStatValue loading={financialStatsLoading} className="text-xl font-semibold text-slate-900 mt-0.5">
              {formatCurrency(stats.netTotal)}
            </DashboardStatValue>
            {!financialStatsLoading && stats.refundsTotal > 0 ? (
              <p className="text-[10px] text-slate-500 mt-0.5">
                {t("finance.revenue.gross")}: {formatCurrency(stats.grossTotal)} · {t("finance.revenue.refunds")}: −
                {formatCurrency(stats.refundsTotal)}
              </p>
            ) : null}
            {!financialStatsLoading && stats.pendingRefundsTotal > 0 ? (
              <p className="text-[10px] text-slate-500 mt-0.5">
                {t("finance.revenue.pendingRefunds")}: {formatCurrency(stats.pendingRefundsTotal)}
              </p>
            ) : null}
            {!financialStatsLoading ? (
              <>
                <div className="flex items-center gap-1 mt-0.5">
                  {momPositive && <ArrowUp className="w-3 h-3 text-indigo-600" />}
                  {momNegative && <ArrowDown className="w-3 h-3 text-rose-600" />}
                  <p
                    className={`text-[10px] font-semibold ${
                      momPositive ? "text-indigo-600" : momNegative ? "text-rose-600" : "text-slate-500"
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
              </>
            ) : null}
          </div>
          <div className="bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-100">
            <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">{t("dashboard.subscriptions")}</p>
            <DashboardStatValue loading={financialStatsLoading} className="text-xl font-semibold text-indigo-700 mt-0.5">
              {formatCurrency(stats.subscriptionTotal)}
            </DashboardStatValue>
          </div>
          {personalLessonsEnabled ? (
            <div className="bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-100">
              <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">{t("dashboard.personal")}</p>
              <DashboardStatValue loading={financialStatsLoading} className="text-xl font-semibold text-indigo-700 mt-0.5">
                {formatCurrency(stats.personalTotal)}
              </DashboardStatValue>
            </div>
          ) : null}
          <div className="bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-100">
            <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">{t("dashboard.singleVisits")}</p>
            <DashboardStatValue loading={financialStatsLoading} className="text-xl font-semibold text-indigo-700 mt-0.5">
              {formatCurrency(stats.singleVisitTotal)}
            </DashboardStatValue>
          </div>
          <div className="bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-100">
            <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">{t("dashboard.receivables")}</p>
            <DashboardStatValue loading={receivablesLoading} className="text-xl font-semibold text-rose-700 mt-0.5">
              {formatCurrency(totalDebt)}
            </DashboardStatValue>
            {!receivablesLoading ? (
              <p className="text-[10px] text-slate-500 mt-0.5">
                {personalLessonsEnabled
                  ? t("dashboard.receivablesBreakdown", { subs: lowBalanceCount, personal: unpaidPersonalCount })
                  : t("dashboard.receivablesBreakdownSubsOnly", { subs: lowBalanceCount })}
              </p>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 pt-1 border-t border-slate-100">
          <div className="bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-100">
            <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">
              {t("dashboard.expensesMonth")}
            </p>
            <DashboardStatValue loading={expensesLoading} className="text-xl font-semibold text-rose-700 mt-0.5">
              {formatCurrency(expensesTotal)}
            </DashboardStatValue>
            {!expensesLoading ? (
              <p className="text-[10px] text-slate-500 mt-0.5">
                {t("venueCosts.finance.manualTotal")}: {formatCurrency(manualExpensesTotal)}
                {financeCostsUnavailable ? (
                  <> · {t("venueCosts.finance.venueTotal")}: —</>
                ) : (
                  <> · {t("venueCosts.finance.venueTotal")}: {formatCurrency(venueCostsTotal)}</>
                )}
              </p>
            ) : null}
          </div>
          <div className="bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-100">
            <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">
              {t("dashboard.payrollAccrued")}
            </p>
            <DashboardStatValue
              loading={payrollQuery.isLoading || recalculatePayroll.isPending}
              className="text-xl font-semibold text-slate-700 mt-0.5"
            >
              {formatCurrency(payrollAccrued)}
            </DashboardStatValue>
            <p className="text-[10px] text-slate-500 mt-0.5">{t("dashboard.payrollAccruedHint")}</p>
          </div>
          <div className="bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-100">
            <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">
              {t("dashboard.profit")}
            </p>
            <DashboardStatValue
              loading={profitLoading}
              className={`text-xl font-semibold mt-0.5 ${
                profit >= 0 ? "text-indigo-700" : "text-rose-700"
              }`}
            >
              {formatCurrency(profit)}
            </DashboardStatValue>
            <p className="text-[10px] text-slate-500 mt-0.5">{t("dashboard.profitHint")}</p>
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
                  {getPaymentMethodLabel(method as PaymentMethod, t) ?? method}
                </span>
                <span className="font-semibold text-slate-800">{formatCurrency(amount)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 pt-1 border-t border-slate-100 lg:grid-cols-[minmax(0,65fr)_minmax(0,35fr)]">
          <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-3 space-y-2 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">
                {t("dashboard.revenueTrend")}
              </p>
              <div className="w-[7.5rem] shrink-0">
                <AppSelect
                  value={trendPeriod}
                  onChange={(e) => setTrendPeriod(e.target.value as RevenueTrendPeriod)}
                  className="h-8 text-[11px] py-0"
                  aria-label={t("dashboard.revenueTrendPeriodLabel")}
                >
                  <option value="month">{t("dashboard.revenueTrendPeriod.month")}</option>
                  <option value="6months">{t("dashboard.revenueTrendPeriod.6months")}</option>
                  <option value="year">{t("dashboard.revenueTrendPeriod.year")}</option>
                </AppSelect>
              </div>
            </div>
            {paymentsQuery.isLoading ? (
              <p className="text-xs text-slate-500 py-8 text-center">{t("dashboard.loading")}</p>
            ) : (
              <RevenueTrendChart points={trendPoints} locale={locale} period={trendPeriod} />
            )}
          </div>
          <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-3 space-y-2">
            <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">
              {t("dashboard.revenueSplit")}
            </p>
            {financialStatsLoading ? (
              <p className="text-xs text-slate-500 py-8 text-center flex items-center justify-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" aria-hidden />
                {t("common.loading.default")}
              </p>
            ) : stats.netTotal > 0 ? (
              <RevenueSplitChart segments={revenueSplit} labelForKey={splitLabel} />
            ) : (
              <p className="text-xs text-slate-500 py-8 text-center">{t("dashboard.noRevenueInMonth")}</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-1 border-t border-slate-100">
          <div className="bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-100">
            <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider flex items-center gap-1">
              <UserPlus className="w-3 h-3" />
              {t("dashboard.newClients")}
            </p>
            <DashboardStatValue loading={analyticsLoading} className="text-xl font-semibold text-slate-900 mt-0.5">
              {newClientsCount}
            </DashboardStatValue>
            <p className="text-[10px] text-slate-500 mt-0.5">{t("dashboard.newClientsInMonth")}</p>
          </div>
          <div className="bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-100 col-span-1 lg:col-span-1">
            <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider flex items-center gap-1">
              <ClipboardCheck className="w-3 h-3" />
              {t("dashboard.occupancy")}
            </p>
            <DashboardStatValue loading={analyticsLoading} className="text-xl font-semibold text-indigo-700 mt-0.5">
              {formatOccupancyPercent(occupancyStats.rate)}
            </DashboardStatValue>
            {!analyticsLoading ? (
              <p className="text-[10px] text-slate-500 mt-0.5">
                {occupancyStats.marked > 0
                  ? t("dashboard.occupancyDetail", {
                      present: occupancyStats.present,
                      absent: occupancyStats.absent,
                    })
                  : t("dashboard.noOccupancyData")}
              </p>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 pt-1 border-t border-slate-100">
          <RevenueRankList
            title={t("dashboard.topClients")}
            icon={Users}
            entries={topClients}
            emptyLabel={t("dashboard.noRankingData")}
            loadingLabel={t("dashboard.loading")}
            loading={analyticsLoading || paymentsQuery.isLoading}
          />
          <RevenueRankList
            title={t("dashboard.topTeachers")}
            icon={GraduationCap}
            entries={topTeachers}
            emptyLabel={t("dashboard.noRankingData")}
            loadingLabel={t("dashboard.loading")}
            loading={analyticsLoading || paymentsQuery.isLoading}
          />
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
            {plural(debtors.length, [
              t("common.records.one", { count: debtors.length }),
              t("common.records.few", { count: debtors.length }),
              t("common.records.many", { count: debtors.length }),
            ])}
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
