import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, ChevronLeft, ChevronRight, AlertTriangle, Loader2 } from "lucide-react";
import QueryErrorState from "../ui/QueryErrorState";
import { useRenterMiniappDashboardStats } from "../../hooks/useRenterMiniappDashboardStats";
import { useI18n } from "../../hooks/useI18n";
import {
  currentYearMonth,
  formatCurrency,
  formatMonthTitle,
  shiftMonth,
} from "../../lib/utils";
import { isFutureYearMonth } from "../../lib/financeMonthUrl";

export default function HallRentalDashboardBlock() {
  const navigate = useNavigate();
  const { t, locale } = useI18n();
  const [statsMonth, setStatsMonth] = useState(currentYearMonth());
  const isViewingCurrentMonth = statsMonth === currentYearMonth();
  const canGoNextMonth = !isFutureYearMonth(shiftMonth(statsMonth, 1));

  const statsQuery = useRenterMiniappDashboardStats(statsMonth);
  const stats = statsQuery.data;

  const conversionLabel = useMemo(() => {
    if (!stats || stats.topupConversionRate == null) return "—";
    return `${Math.round(stats.topupConversionRate * 100)}%`;
  }, [stats]);

  const conversionHint = useMemo(() => {
    if (!stats || stats.topupSubmitted <= 0) return "";
    return t("dashboard.hallRental.conversionHint", {
      confirmed: stats.topupConfirmed,
      rejected: stats.topupRejected,
      submitted: stats.topupSubmitted,
    });
  }, [stats, t]);

  if (statsQuery.isError) {
    return (
      <QueryErrorState
        message={t("dashboard.hallRental.error.loadFailed")}
        onRetry={() => void statsQuery.refetch()}
      />
    );
  }

  if (stats && !stats.addonActive) {
    return null;
  }

  return (
    <div className="bg-white rounded-xl p-3.5 border border-slate-200/90 shadow-xs space-y-3">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
        <h2 className="font-sans text-sm font-semibold text-slate-800 flex items-center gap-2">
          <Building2 className="w-4 h-4 text-indigo-500" />
          {t("dashboard.hallRental.title")}
        </h2>
        <div className="flex items-center gap-2">
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
              <span className="text-xs font-semibold text-slate-800">
                {formatMonthTitle(statsMonth, locale)}
              </span>
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
              disabled={!canGoNextMonth}
              className="p-1 rounded-lg hover:bg-slate-50 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label={t("subscriptions.aria.nextMonth")}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => navigate("/finance/renter-topup")}
            className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer whitespace-nowrap"
          >
            {t("dashboard.hallRental.openInbox")}
          </button>
        </div>
      </div>

      <p className="text-[10px] text-slate-500">{t("dashboard.hallRental.subtitle")}</p>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <StatCard
          label={t("dashboard.hallRental.revenue")}
          loading={statsQuery.isLoading}
          value={formatCurrency(stats?.revenue ?? 0)}
          hint={t("dashboard.hallRental.revenueHint")}
        />
        <StatCard
          label={t("dashboard.hallRental.occupancy")}
          loading={statsQuery.isLoading}
          value={String(stats?.occupancySlots ?? 0)}
          hint={t("dashboard.hallRental.occupancyHint")}
        />
        <StatCard
          label={t("dashboard.hallRental.debt")}
          loading={statsQuery.isLoading}
          value={formatCurrency(stats?.debtTotal ?? 0)}
          hint={t("dashboard.hallRental.debtHint")}
          highlight={(stats?.debtTotal ?? 0) > 0}
        />
        <StatCard
          label={t("dashboard.hallRental.pending")}
          loading={statsQuery.isLoading}
          value={String(stats?.pendingCount ?? 0)}
          hint={t("dashboard.hallRental.pendingHint")}
          highlight={(stats?.pendingSlaBreached ?? 0) > 0}
          badge={
            (stats?.pendingSlaBreached ?? 0) > 0 ? (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-rose-700">
                <AlertTriangle className="w-3 h-3" />
                {t("dashboard.hallRental.slaBreached", { count: stats?.pendingSlaBreached ?? 0 })}
              </span>
            ) : null
          }
        />
        <StatCard
          label={t("dashboard.hallRental.expiringHolds")}
          loading={statsQuery.isLoading}
          value={String(stats?.expiringHolds ?? 0)}
          hint={t("dashboard.hallRental.expiringHoldsHint")}
          highlight={(stats?.expiringHolds ?? 0) > 0}
        />
        <StatCard
          label={t("dashboard.hallRental.conversion")}
          loading={statsQuery.isLoading}
          value={conversionLabel}
          hint={conversionHint}
        />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  loading,
  highlight = false,
  badge,
}: {
  label: string;
  value: string;
  hint?: string;
  loading: boolean;
  highlight?: boolean;
  badge?: React.ReactNode;
}) {
  return (
    <div className="bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-100">
      <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">{label}</p>
      <DashboardStatValue loading={loading} className={`text-xl font-semibold mt-0.5 ${highlight ? "text-rose-700" : "text-slate-900"}`}>
        {value}
      </DashboardStatValue>
      {badge ? <div className="mt-0.5">{badge}</div> : null}
      {hint ? <p className="text-[10px] text-slate-500 mt-0.5">{hint}</p> : null}
    </div>
  );
}

function DashboardStatValue({
  loading,
  children,
  className,
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
