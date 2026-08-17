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
  RefreshCw,
} from "lucide-react";
import {
  buildClassLocationMap,
  buildClassTeacherMap,
  buildDaySeries,
  buildExtendedTrendPoints,
  buildMonthSeries,
  buildRevenueSplit,
  buildTopClientsByRevenue,
  buildTopTeachersByRevenue,
  buildExtendedRevenueStats,
  computeMomChangePercent,
  computeOccupancyStats,
  countNewClientsInMonth,
  extendedNetTotalForMonth,
  otherIncomeInMonth,
  refundsInMonth,
  rentalEntriesInMonth,
  formatMomPercent,
  formatOccupancyPercent,
  paymentsInMonth,
  revenueTrendMonthCount,
  shiftMonth,
  sumDebtorAmounts,
  monthDateRange,
  monthTrendRange,
  type MonthlyRevenuePoint,
  type RevenueRankEntry,
  type RevenueSplitKey,
  type RevenueSplitSegment,
  type RevenueTrendPeriod,
} from "../lib/financeReports";
import { financePathWithMonth, isFutureYearMonth } from "../lib/financeMonthUrl";
import {
  currentYearMonth,
  formatCurrency,
  formatMonthTitle,
} from "../lib/utils";
import { useI18n } from "../hooks/useI18n";
import { useToast } from "../App";
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
import { useTeacherSettlements } from "../hooks/usePayroll";
import { useSchedule } from "../hooks/useSchedule";
import { useSubscriptionGroups } from "../hooks/useSubscriptionGroups";
import { useSubscriptions } from "../hooks/useSubscriptions";
import { memberListLabel, useTeamMembers } from "../hooks/useTeamMembers";
import { useSingleVisits } from "../hooks/useSingleVisits";
import AppSelect from "./ui/AppSelect";
import QueryErrorState from "./ui/QueryErrorState";

const SPLIT_COLORS: Record<RevenueSplitKey, string> = {
  subscription: "bg-gold-500",
  personal: "bg-gold-700",
  single_visit: "bg-gold-400",
  other: "bg-ink-400",
  rental: "bg-lavender-500",
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

        {containerWidth >= 640 ? (
          <>
            <text
              x={plotLeft - 4}
              y={maxY + 3}
              textAnchor="end"
              className="fill-ink-400"
              fontSize="8"
            >
              {maxLabel}
            </text>
            <text
              x={plotLeft - 4}
              y={avgY + 3}
              textAnchor="end"
              className="fill-ink-400"
              fontSize="8"
            >
              {avgLabel}
            </text>
          </>
        ) : null}

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
                onClick={() => setHoveredIndex((prev) => (prev === index ? null : index))}
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
              className="fill-ink-400"
              fontSize="9"
            >
              {formatTrendPointLabel(point.month, period, locale)}
            </text>
          );
        })}
      </svg>

      {hovered && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-md border border-ink-200 bg-white px-2 py-1 shadow-sm"
          style={{
            left: (hovered.x / width) * 100 + "%",
            top: Math.max(hovered.y - 44, 0),
          }}
        >
          <p className="text-[10px] text-ink-500 whitespace-nowrap">
            {formatTrendPointLabel(hovered.month, period, locale)}
          </p>
          <p className="text-xs font-semibold text-ink-800 whitespace-nowrap">
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
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-ink-100">
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
              <span className="text-ink-600 truncate">{labelForKey(segment.key)}</span>
            </div>
            <div className="text-right shrink-0">
              <span className="font-semibold text-ink-800">{formatCurrency(segment.amount)}</span>
              <span className="text-ink-400 ml-1.5">{segment.percent.toFixed(0)}%</span>
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
      <p className={`${className} text-ink-400 flex items-center gap-1.5`}>
        <Loader2 className="w-4 h-4 animate-spin shrink-0 text-gold-400" aria-hidden />
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
    <div className="rounded-lg border border-ink-100 bg-ink-50/10 p-3 space-y-2">
      <p className="text-[10px] text-ink-500 uppercase font-semibold tracking-wider flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5" />
        {title}
      </p>
      {loading ? (
        <p className="text-xs text-ink-500 py-6 text-center">{loadingLabel}</p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-ink-500 py-6 text-center">{emptyLabel}</p>
      ) : (
        <ol className="space-y-2">
          {entries.map((entry, index) => (
            <li key={entry.key} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-xs font-sans">
                <span className="text-ink-600 truncate min-w-0">
                  <span className="text-ink-400 mr-1.5">{index + 1}.</span>
                  {entry.label}
                </span>
                <span className="font-semibold text-ink-800 shrink-0">{formatCurrency(entry.amount)}</span>
              </div>
              <div className="h-1.5 rounded-full bg-ink-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gold-500"
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
  const toast = useToast();
  const { t, locale, plural } = useI18n();
  const { can } = usePermissions();
  const personalLessonsEnabled = usePersonalLessonsModuleEnabled();
  const canReadFinance = can("finance.read");
  const canShowOperationalAnalytics = can("reports.operational");
  const [statsMonth, setStatsMonth] = useState(currentYearMonth());
  const [trendPeriod, setTrendPeriod] = useState<RevenueTrendPeriod>("6months");
  const isViewingCurrentMonth = statsMonth === currentYearMonth();
  const canGoNextMonth = !isFutureYearMonth(shiftMonth(statsMonth, 1));

  const trendFetchMonths = revenueTrendMonthCount(trendPeriod);
  const trendDataRange = useMemo(() => {
    if (trendPeriod === "month") return monthDateRange(statsMonth);
    return monthTrendRange(statsMonth, trendFetchMonths);
  }, [statsMonth, trendPeriod, trendFetchMonths]);
  const paymentsQuery = usePaymentsTrend(statsMonth, trendFetchMonths);
  const refundsQuery = useSubscriptionRefunds();
  const expensesQuery = useExpensesForMonth(statsMonth);
  const monthRange = useMemo(() => monthDateRange(statsMonth), [statsMonth]);
  const financeCostsQuery = useFinanceCosts(monthRange.dateFrom, monthRange.dateTo);
  const otherIncomeQuery = useOtherIncome({
    dateFrom: trendDataRange.dateFrom,
    dateTo: trendDataRange.dateTo,
  });
  const rentalPaymentsQuery = useRentalPayments({
    dateFrom: trendDataRange.dateFrom,
    dateTo: trendDataRange.dateTo,
  });
  const payrollQuery = useTeacherSettlements(statsMonth);
  const recalculateVenueCosts = useRecalculatePendingVenueCosts();
  const venueRecalcIdempotencyKey = useMemo(() => crypto.randomUUID(), [statsMonth]);
  const debtorsQuery = useFinancialDebtors();
  const clientsQuery = useClients({ enabled: canShowOperationalAnalytics });
  const attendanceQuery = useAttendanceRecords(statsMonth, { enabled: canShowOperationalAnalytics });
  const personalLessonsQuery = usePersonalLessons({
    yearMonth: statsMonth,
    enabled: personalLessonsEnabled && canShowOperationalAnalytics,
  });
  const scheduleQuery = useSchedule({ enabled: canShowOperationalAnalytics });
  const subscriptionGroupsQuery = useSubscriptionGroups({ enabled: canShowOperationalAnalytics });
  const subscriptionsQuery = useSubscriptions({ enabled: canShowOperationalAnalytics });
  const teamQuery = useTeamMembers({ enabled: canShowOperationalAnalytics });
  const singleVisitsQuery = useSingleVisits({
    yearMonth: statsMonth,
    enabled: canShowOperationalAnalytics,
  });

  const financialStatsLoading =
    paymentsQuery.isLoading ||
    refundsQuery.isLoading ||
    otherIncomeQuery.isLoading ||
    rentalPaymentsQuery.isLoading;

  const receivablesLoading = debtorsQuery.isLoading;

  const financialStatsError =
    paymentsQuery.isError ||
    refundsQuery.isError ||
    otherIncomeQuery.isError ||
    rentalPaymentsQuery.isError;

  const expensesLoading =
    expensesQuery.isLoading || (financeCostsQuery.isLoading && !financeCostsQuery.isError);

  const profitLoading = financialStatsLoading || expensesLoading || payrollQuery.isLoading;

  const analyticsLoading =
    canShowOperationalAnalytics &&
    (clientsQuery.isLoading ||
      attendanceQuery.isLoading ||
      subscriptionsQuery.isLoading ||
      (personalLessonsEnabled && personalLessonsQuery.isLoading) ||
      scheduleQuery.isLoading ||
      subscriptionGroupsQuery.isLoading ||
      teamQuery.isLoading ||
      singleVisitsQuery.isLoading);

  const trendContext = useMemo(
    () => ({
      payments: paymentsQuery.data ?? [],
      refunds: refundsQuery.data ?? [],
      otherIncome: (otherIncomeQuery.data ?? []).map((row) => ({
        amount: row.amount,
        createdAt: row.createdAt,
      })),
      rentalEntries: rentalPaymentsQuery.data ?? [],
    }),
    [paymentsQuery.data, refundsQuery.data, otherIncomeQuery.data, rentalPaymentsQuery.data]
  );

  const monthSeries = useMemo(() => {
    if (trendPeriod === "month") return buildDaySeries(statsMonth);
    return buildMonthSeries(statsMonth, trendFetchMonths);
  }, [statsMonth, trendPeriod, trendFetchMonths]);

  const trendPoints = useMemo(() => {
    const mode = trendPeriod === "month" ? ("day" as const) : ("month" as const);
    return buildExtendedTrendPoints(monthSeries, trendContext, mode);
  }, [monthSeries, trendContext, trendPeriod]);

  const stats = useMemo(() => {
    const monthPayments = paymentsInMonth(paymentsQuery.data ?? [], statsMonth);
    const monthRefunds = refundsInMonth(refundsQuery.data ?? [], statsMonth);
    const otherFromTable = otherIncomeInMonth(
      (otherIncomeQuery.data ?? []).map((row) => ({ amount: row.amount, createdAt: row.createdAt })),
      statsMonth
    );
    const rentalForMonth = rentalEntriesInMonth(rentalPaymentsQuery.data ?? [], statsMonth);
    const allPending = (refundsQuery.data ?? []).filter((refund) => refund.status === "pending");
    const base = buildExtendedRevenueStats(monthPayments, monthRefunds, {
      otherIncomeAmount: otherFromTable,
      rentalRegisterEntries: rentalForMonth,
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
  const teacherExpenseTotal = financeCostsQuery.data?.teacherExpenseTotal ?? 0;
  const expensesTotal = useMemo(() => {
    if (financeCostsQuery.data) return financeCostsQuery.data.total;
    return sumExpenses(expensesQuery.data ?? []);
  }, [financeCostsQuery.data, expensesQuery.data]);
  const venueCostsTotal = financeCostsQuery.data?.venueTotal ?? 0;
  const manualExpensesTotal = financeCostsQuery.data?.manualTotal ?? sumExpenses(expensesQuery.data ?? []);

  const handleRecalculateVenueCosts = async () => {
    if (!canReadFinance) return;
    const result = await recalculateVenueCosts.mutateAsync({
      dateFrom: monthRange.dateFrom,
      dateTo: monthRange.dateTo,
      idempotencyKey: venueRecalcIdempotencyKey,
    });
    if (!result.success) {
      toast(t("dashboard.venueCostsRecalculateFailed"), "error");
      return;
    }
    if (result.alreadyApplied) {
      toast(t("dashboard.venueCostsRecalculateAlready"), "info");
      return;
    }
    toast(
      t("dashboard.venueCostsRecalculateSuccess", { count: result.resolvedCount }),
      "success"
    );
  };

  const payrollAccrued = useMemo(
    () => (payrollQuery.data ?? []).reduce((sum, settlement) => sum + settlement.amountAccrued, 0),
    [payrollQuery.data]
  );

  const profit =
    financeCostsUnavailable ? null : stats.netTotal - expensesTotal - payrollAccrued;

  const momPercent = useMemo(() => {
    const previousMonth = shiftMonth(statsMonth, -1);
    const previousTotal = extendedNetTotalForMonth(previousMonth, trendContext);
    return computeMomChangePercent(stats.netTotal, previousTotal);
  }, [stats.netTotal, statsMonth, trendContext]);

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
    if (key === "rental") return t("finance.revenue.rental");
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
      {financialStatsError ? (
        <QueryErrorState
          message={t("dashboard.financialStatsError")}
          onRetry={() => {
            void paymentsQuery.refetch();
            void refundsQuery.refetch();
            void otherIncomeQuery.refetch();
            void rentalPaymentsQuery.refetch();
          }}
        />
      ) : null}
      <div className="bg-white rounded-xl p-3.5 border border-ink-200 shadow-xs space-y-3">
        <div className="flex items-center justify-between gap-2 border-b border-ink-100 pb-2">
          <h2 className="font-sans text-sm font-semibold text-ink-800 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-gold-500" />
            {t("dashboard.financialOverview")}
          </h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setStatsMonth((m) => shiftMonth(m, -1))}
              className="p-1 rounded-lg hover:bg-ink-50 text-ink-500 hover:text-ink-800 transition-colors cursor-pointer"
              aria-label={t("subscriptions.aria.prevMonth")}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex flex-col items-center min-w-0">
              <span className="text-xs font-semibold text-ink-800">{formatMonthTitle(statsMonth, locale)}</span>
              {!isViewingCurrentMonth && (
                <button
                  type="button"
                  onClick={() => setStatsMonth(currentYearMonth())}
                  className="text-[10px] font-semibold text-gold-700 hover:text-gold-800 hover:underline cursor-pointer whitespace-nowrap"
                >
                  {t("common.currentMonth")}
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setStatsMonth((m) => shiftMonth(m, 1))}
              disabled={!canGoNextMonth}
              className="p-1 rounded-lg hover:bg-ink-50 text-ink-500 hover:text-ink-800 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label={t("subscriptions.aria.nextMonth")}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className={`grid gap-3 ${personalLessonsEnabled ? "grid-cols-2 lg:grid-cols-5" : "grid-cols-2 lg:grid-cols-4"}`}>
          <div className="bg-ink-50 rounded-lg px-3 py-2.5 border border-ink-100">
            <p className="text-[10px] text-ink-500 uppercase font-semibold tracking-wider">{t("dashboard.revenue")}</p>
            <DashboardStatValue loading={financialStatsLoading} className="text-xl font-semibold text-ink-900 mt-0.5">
              {formatCurrency(stats.netTotal)}
            </DashboardStatValue>
            {!financialStatsLoading && stats.refundsTotal > 0 ? (
              <p className="text-[10px] text-ink-500 mt-0.5">
                {t("finance.revenue.gross")}: {formatCurrency(stats.grossTotal)} · {t("finance.revenue.refunds")}: −
                {formatCurrency(stats.refundsTotal)}
              </p>
            ) : null}
            {!financialStatsLoading && stats.pendingRefundsTotal > 0 ? (
              <p className="text-[10px] text-ink-500 mt-0.5">
                {t("finance.revenue.pendingRefunds")}: {formatCurrency(stats.pendingRefundsTotal)}
              </p>
            ) : null}
            {!financialStatsLoading ? (
              <>
                <div className="flex items-center gap-1 mt-0.5">
                  {momPositive && <ArrowUp className="w-3 h-3 text-gold-700" />}
                  {momNegative && <ArrowDown className="w-3 h-3 text-garnet-600" />}
                  <p
                    className={`text-[10px] font-semibold ${
                      momPositive ? "text-gold-700" : momNegative ? "text-garnet-600" : "text-ink-500"
                    }`}
                  >
                    {momPercent === null ? t("dashboard.momUnavailable") : formatMomPercent(momPercent)}
                  </p>
                  {momPercent !== null && (
                    <span className="text-[10px] text-ink-500">{t("dashboard.momVsPrevious")}</span>
                  )}
                </div>
                <p className="text-[10px] text-ink-500 mt-0.5">
                  {stats.count}{" "}
                  {plural(stats.count, [t("common.payment.one"), t("common.payment.few"), t("common.payment.many")])}
                </p>
              </>
            ) : null}
          </div>
          <div className="bg-ink-50 rounded-lg px-3 py-2.5 border border-ink-100">
            <p className="text-[10px] text-ink-500 uppercase font-semibold tracking-wider">{t("dashboard.subscriptions")}</p>
            <DashboardStatValue loading={financialStatsLoading} className="text-xl font-semibold text-gold-700 mt-0.5">
              {formatCurrency(stats.subscriptionTotal)}
            </DashboardStatValue>
          </div>
          {personalLessonsEnabled ? (
            <div className="bg-ink-50 rounded-lg px-3 py-2.5 border border-ink-100">
              <p className="text-[10px] text-ink-500 uppercase font-semibold tracking-wider">{t("dashboard.personal")}</p>
              <DashboardStatValue loading={financialStatsLoading} className="text-xl font-semibold text-gold-700 mt-0.5">
                {formatCurrency(stats.personalTotal)}
              </DashboardStatValue>
            </div>
          ) : null}
          <div className="bg-ink-50 rounded-lg px-3 py-2.5 border border-ink-100">
            <p className="text-[10px] text-ink-500 uppercase font-semibold tracking-wider">{t("dashboard.singleVisits")}</p>
            <DashboardStatValue loading={financialStatsLoading} className="text-xl font-semibold text-gold-700 mt-0.5">
              {formatCurrency(stats.singleVisitTotal)}
            </DashboardStatValue>
          </div>
          <div className="bg-ink-50 rounded-lg px-3 py-2.5 border border-ink-100">
            <p className="text-[10px] text-ink-500 uppercase font-semibold tracking-wider">{t("dashboard.receivables")}</p>
            <DashboardStatValue loading={receivablesLoading} className="text-xl font-semibold text-garnet-700 mt-0.5">
              {formatCurrency(totalDebt)}
            </DashboardStatValue>
            {!receivablesLoading ? (
              <p className="text-[10px] text-ink-500 mt-0.5">
                {personalLessonsEnabled
                  ? t("dashboard.receivablesBreakdown", { subs: lowBalanceCount, personal: unpaidPersonalCount })
                  : t("dashboard.receivablesBreakdownSubsOnly", { subs: lowBalanceCount })}
              </p>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 pt-1 border-t border-ink-100">
          <div className="bg-ink-50 rounded-lg px-3 py-2.5 border border-ink-100">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[10px] text-ink-500 uppercase font-semibold tracking-wider">
                {t("dashboard.expensesMonth")}
              </p>
              {canReadFinance ? (
                <button
                  type="button"
                  onClick={() => void handleRecalculateVenueCosts()}
                  disabled={recalculateVenueCosts.isPending}
                  aria-label={t("dashboard.venueCostsRecalculate")}
                  title={t("dashboard.venueCostsRecalculate")}
                  className="inline-flex items-center gap-1 text-[10px] font-sans font-semibold text-gold-700 hover:text-gold-800 disabled:opacity-50 shrink-0"
                >
                  <RefreshCw
                    className={`w-3 h-3 ${recalculateVenueCosts.isPending ? "animate-spin" : ""}`}
                  />
                  <span className="hidden sm:inline">{t("dashboard.venueCostsRecalculate")}</span>
                </button>
              ) : null}
            </div>
            <DashboardStatValue loading={expensesLoading} className="text-xl font-semibold text-garnet-700 mt-0.5">
              {formatCurrency(expensesTotal)}
            </DashboardStatValue>
            {!expensesLoading ? (
              <p className="text-[10px] text-ink-500 mt-0.5">
                {t("venueCosts.finance.manualTotal")}: {formatCurrency(manualExpensesTotal)}
                {financeCostsUnavailable ? (
                  <> · {t("venueCosts.finance.venueTotal")}: —</>
                ) : (
                  <> · {t("venueCosts.finance.venueTotal")}: {formatCurrency(venueCostsTotal)}</>
                )}
                {!financeCostsUnavailable && teacherExpenseTotal > 0 ? (
                  <>
                    {" "}
                    · {t("venueCosts.finance.teacherExpenseTotal")}: {formatCurrency(teacherExpenseTotal)}
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
          <div className="bg-ink-50 rounded-lg px-3 py-2.5 border border-ink-100">
            <p className="text-[10px] text-ink-500 uppercase font-semibold tracking-wider">
              {t("dashboard.payrollAccrued")}
            </p>
            <DashboardStatValue
              loading={payrollQuery.isLoading}
              className="text-xl font-semibold text-ink-700 mt-0.5"
            >
              {formatCurrency(payrollAccrued)}
            </DashboardStatValue>
            <p className="text-[10px] text-ink-500 mt-0.5">{t("dashboard.payrollAccruedHint")}</p>
          </div>
          <div className="bg-ink-50 rounded-lg px-3 py-2.5 border border-ink-100">
            <p className="text-[10px] text-ink-500 uppercase font-semibold tracking-wider">
              {t("dashboard.profit")}
            </p>
            <DashboardStatValue
              loading={profitLoading}
              className={`text-xl font-semibold mt-0.5 ${
                profit === null ? "text-ink-500" : profit >= 0 ? "text-gold-700" : "text-garnet-700"
              }`}
            >
              {profit === null ? "—" : formatCurrency(profit)}
            </DashboardStatValue>
            <p className="text-[10px] text-ink-500 mt-0.5">
              {financeCostsUnavailable ? t("dashboard.profitUnavailable") : t("dashboard.profitHint")}
            </p>
          </div>
        </div>

        {Object.keys(stats.byMethod).length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {Object.entries(stats.byMethod).map(([method, amount]) => (
              <div
                key={method}
                className="flex items-center justify-between px-3 py-2 rounded-lg border border-ink-100 text-xs font-sans"
              >
                <span className="text-ink-500">
                  {getPaymentMethodLabel(method as PaymentMethod, t) ?? method}
                </span>
                <span className="font-semibold text-ink-800">{formatCurrency(amount)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 pt-1 border-t border-ink-100 lg:grid-cols-[minmax(0,65fr)_minmax(0,35fr)]">
          <div className="rounded-lg border border-ink-100 bg-ink-50/10 p-3 space-y-2 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] text-ink-500 uppercase font-semibold tracking-wider">
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
              <p className="text-xs text-ink-500 py-8 text-center">{t("dashboard.loading")}</p>
            ) : (
              <RevenueTrendChart points={trendPoints} locale={locale} period={trendPeriod} />
            )}
          </div>
          <div className="rounded-lg border border-ink-100 bg-ink-50/10 p-3 space-y-2">
            <p className="text-[10px] text-ink-500 uppercase font-semibold tracking-wider">
              {t("dashboard.revenueSplit")}
            </p>
            {financialStatsLoading ? (
              <p className="text-xs text-ink-500 py-8 text-center flex items-center justify-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-gold-400" aria-hidden />
                {t("common.loading.default")}
              </p>
            ) : stats.netTotal > 0 ? (
              <RevenueSplitChart segments={revenueSplit} labelForKey={splitLabel} />
            ) : (
              <p className="text-xs text-ink-500 py-8 text-center">{t("dashboard.noRevenueInMonth")}</p>
            )}
          </div>
        </div>

        {canShowOperationalAnalytics ? (
          <>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-1 border-t border-ink-100">
          <div className="bg-ink-50 rounded-lg px-3 py-2.5 border border-ink-100">
            <p className="text-[10px] text-ink-500 uppercase font-semibold tracking-wider flex items-center gap-1">
              <UserPlus className="w-3 h-3" />
              {t("dashboard.newClients")}
            </p>
            <DashboardStatValue loading={analyticsLoading} className="text-xl font-semibold text-ink-900 mt-0.5">
              {newClientsCount}
            </DashboardStatValue>
            <p className="text-[10px] text-ink-500 mt-0.5">{t("dashboard.newClientsInMonth")}</p>
          </div>
          <div className="bg-ink-50 rounded-lg px-3 py-2.5 border border-ink-100 col-span-1 lg:col-span-1">
            <p className="text-[10px] text-ink-500 uppercase font-semibold tracking-wider flex items-center gap-1">
              <ClipboardCheck className="w-3 h-3" />
              {t("dashboard.occupancy")}
            </p>
            <DashboardStatValue loading={analyticsLoading} className="text-xl font-semibold text-gold-700 mt-0.5">
              {formatOccupancyPercent(occupancyStats.rate)}
            </DashboardStatValue>
            {!analyticsLoading ? (
              <p className="text-[10px] text-ink-500 mt-0.5">
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

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 pt-1 border-t border-ink-100">
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
          </>
        ) : null}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <motion.button
          type="button"
          whileHover={{ y: -2 }}
          onClick={() => navigate(financePathWithMonth("/finance/revenue", statsMonth))}
          className="bg-white rounded-xl px-3 py-3 border border-ink-200 shadow-xs text-left hover:shadow-sm transition-all cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <TrendingUp className="w-4 h-4 text-gold-500" />
            <ArrowRight className="w-3.5 h-3.5 text-ink-400" />
          </div>
          <p className="text-xs font-semibold text-ink-800 mt-2">{t("dashboard.revenue")}</p>
          <p className="text-[10px] text-ink-500 mt-0.5">{t("dashboard.revenueDetail")}</p>
        </motion.button>

        <motion.button
          type="button"
          whileHover={{ y: -2 }}
          onClick={() => navigate("/finance/debtors")}
          className="bg-white rounded-xl px-3 py-3 border border-ink-200 shadow-xs text-left hover:shadow-sm transition-all cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <AlertCircle className="w-4 h-4 text-garnet-600" />
            <ArrowRight className="w-3.5 h-3.5 text-ink-400" />
          </div>
          <p className="text-xs font-semibold text-ink-800 mt-2">{t("dashboard.debtors")}</p>
          <p className="text-[10px] text-ink-500 mt-0.5">
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
          onClick={() => navigate(financePathWithMonth("/finance/payments", statsMonth))}
          className="bg-white rounded-xl px-3 py-3 border border-ink-200 shadow-xs text-left hover:shadow-sm transition-all cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <Landmark className="w-4 h-4 text-gold-500" />
            <ArrowRight className="w-3.5 h-3.5 text-ink-400" />
          </div>
          <p className="text-xs font-semibold text-ink-800 mt-2">{t("dashboard.paymentJournal")}</p>
          <p className="text-[10px] text-ink-500 mt-0.5">{t("dashboard.fullHistory")}</p>
        </motion.button>
      </div>
    </div>
  );
}
