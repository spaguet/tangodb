import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BarChart3, TrendingUp } from "lucide-react";
import OperationalDashboard from "../components/OperationalDashboard";
import FinancialDashboard from "../components/FinancialDashboard";
import TeacherScopedDashboard from "../components/TeacherScopedDashboard";
import LoadingState from "../components/ui/LoadingState";
import QueryErrorState from "../components/ui/QueryErrorState";
import PageTabs, { pageTabPanelCls, type PageTabItem } from "../components/ui/PageTabs";
import { useClientDirectory } from "../hooks/useClients";
import { useDisciplines } from "../hooks/useDisciplines";
import { usePersonalLessons } from "../hooks/usePersonalLessons";
import { useSchedule } from "../hooks/useSchedule";
import { useSubscriptions } from "../hooks/useSubscriptions";
import { usePayments } from "../hooks/usePayments";
import { usePermissions } from "../hooks/usePermissions";
import { useI18n } from "../hooks/useI18n";
import { useUIStore } from "../store/ui";
import { useOrganization } from "../organization/OrganizationProvider";
import { getDashboardTabs } from "../lib/i18n";
import { normalizeOrgModules } from "../lib/orgModules";
import type { Client, PersonalLesson, Subscription } from "../types";
import DemoDashboardBanner from "../components/demo/DemoDashboardBanner";
import VenueRuleExpiryNotice from "../components/venue-costs/VenueRuleExpiryNotice";
import HallRentalDashboardBlock from "../components/dashboard/HallRentalDashboardBlock";
import { useVenueCostRuleStatus } from "../hooks/useVenueCosts";
import { isTopupSlaEscalationRole } from "../lib/showRenterTopupNav";

type DashboardTab = "operational" | "financial";

type DashboardTabItem = PageTabItem & { id: DashboardTab };

const DASHBOARD_TAB_ICONS: Record<DashboardTab, typeof BarChart3> = {
  operational: BarChart3,
  financial: TrendingUp,
};

export default function DashboardPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { orgLoading, organizationId, settings } = useOrganization();
  const setSubscriptionsTab = useUIStore((s) => s.setSubscriptionsTab);
  const { can } = usePermissions();
  const [activeTab, setActiveTab] = useState<DashboardTab>("operational");

  const dashboardTabs = useMemo<DashboardTabItem[]>(
    () =>
      getDashboardTabs(t).map((tab) => ({
        ...tab,
        icon: DASHBOARD_TAB_ICONS[tab.id],
      })),
    [t]
  );

  const modules = normalizeOrgModules(settings?.modules);
  const personalLessonsEnabled = modules.personal_lessons;
  const showFinancial = can("reports.financial") && modules.finance_basic;
  const showOperational = can("reports.operational");
  const showBoth = showOperational && showFinancial;
  const showScopedSummary = can("dashboard.scoped_summary");
  const scopedOnly = showScopedSummary && !showOperational && !showFinancial;

  const operationalEnabled = showOperational && (!showBoth || activeTab === "operational");

  const clientsQuery = useClientDirectory({ enabled: operationalEnabled });
  const subscriptionsQuery = useSubscriptions({ enabled: operationalEnabled });
  const personalLessonsQuery = usePersonalLessons({
    enabled: operationalEnabled && personalLessonsEnabled,
  });
  const showOperationalPayments = operationalEnabled && can("payments.read.operational");
  const todayPaymentsQuery = usePayments(
    showOperationalPayments ? { todayOnly: true } : { enabled: false }
  );

  const scopedLessonsQuery = usePersonalLessons({
    enabled: scopedOnly && personalLessonsEnabled,
  });
  const scopedScheduleQuery = useSchedule({ enabled: scopedOnly });
  const disciplinesQuery = useDisciplines({ enabled: scopedOnly });

  const handleNavigate = (panel: string) => {
    const routes: Record<string, { path: string; subTab?: "active" | "sell" }> = {
      activeSubs: { path: "/subscriptions", subTab: "active" },
      personalView: { path: "/personal" },
      attendance: { path: "/attendance" },
      schedule: { path: "/schedule" },
      payroll: { path: "/finance/payroll" },
    };

    const route = routes[panel] ?? { path: "/" };
    if (route.subTab) setSubscriptionsTab(route.subTab);
    navigate(route.path);
  };

  if (orgLoading || !organizationId) {
    return <LoadingState label={t("common.loading.organization")} />;
  }
  if (!showFinancial && !showOperational && !showScopedSummary) {
    return <DashboardNoAccess />;
  }

  if (scopedOnly) {
    return (
      <DashboardShell>
        <ScopedDashboardView
          lessonsQuery={scopedLessonsQuery}
          scheduleQuery={scopedScheduleQuery}
          disciplinesQuery={disciplinesQuery}
          personalLessonsEnabled={personalLessonsEnabled}
          onNavigate={handleNavigate}
        />
      </DashboardShell>
    );
  }

  if (showFinancial && !showOperational) {
    return (
      <DashboardShell>
        <FinancialDashboard />
      </DashboardShell>
    );
  }

  if (showBoth && activeTab === "financial") {
    return (
      <DashboardShell>
        <DashboardWithTabs activeTab={activeTab} onTabChange={setActiveTab} dashboardTabs={dashboardTabs}>
          <FinancialDashboard />
        </DashboardWithTabs>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell>
    <OperationalDashboardView
      showBoth={showBoth}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      dashboardTabs={dashboardTabs}
      clientsQuery={clientsQuery}
      subscriptionsQuery={subscriptionsQuery}
      personalLessonsQuery={personalLessonsQuery}
      todayPaymentsQuery={todayPaymentsQuery}
      showOperationalPayments={showOperationalPayments}
      personalLessonsEnabled={personalLessonsEnabled}
      onNavigate={handleNavigate}
    />
    </DashboardShell>
  );
}

function DashboardShell({ children }: { children: React.ReactNode }) {
  const { role } = usePermissions();
  const venueStatusQuery = useVenueCostRuleStatus({ enabled: role !== "teacher" });
  const showHallRentalBlock = isTopupSlaEscalationRole(role);
  return (
    <div className="panel-page-stack">
      <DemoDashboardBanner />
      {role !== "teacher" && venueStatusQuery.data?.acknowledgementRequired && (
        <VenueRuleExpiryNotice status={venueStatusQuery.data} />
      )}
      {showHallRentalBlock ? <HallRentalDashboardBlock /> : null}
      {children}
    </div>
  );
}

function DashboardNoAccess() {
  const { t } = useI18n();
  const { role } = usePermissions();

  return (
    <div className="panel-page-stack">
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs py-20 text-center px-6">
        <p className="text-sm text-slate-500">
          {role === "teacher" ? t("dashboard.noAccessTeacher") : t("dashboard.noAccess")}
        </p>
      </div>
    </div>
  );
}

function DashboardWithTabs({
  activeTab,
  onTabChange,
  dashboardTabs,
  children,
}: {
  activeTab: DashboardTab;
  onTabChange: (tab: DashboardTab) => void;
  dashboardTabs: DashboardTabItem[];
  children: React.ReactNode;
}) {
  return (
    <div>
      <PageTabs tabs={dashboardTabs} activeTab={activeTab} onChange={(tab) => onTabChange(tab as DashboardTab)} />
      <div
        role="tabpanel"
        className={`bg-white p-4 border border-slate-200 shadow-xs panel-card-stack ${pageTabPanelCls(activeTab, "operational")}`}
      >
        {children}
      </div>
    </div>
  );
}

function ScopedDashboardView({
  lessonsQuery,
  scheduleQuery,
  disciplinesQuery,
  personalLessonsEnabled,
  onNavigate,
}: {
  lessonsQuery: ReturnType<typeof usePersonalLessons>;
  scheduleQuery: ReturnType<typeof useSchedule>;
  disciplinesQuery: ReturnType<typeof useDisciplines>;
  personalLessonsEnabled: boolean;
  onNavigate: (panel: string) => void;
}) {
  const { t } = useI18n();
  const isLoading =
    (personalLessonsEnabled && lessonsQuery.isLoading) ||
    scheduleQuery.isLoading ||
    disciplinesQuery.isLoading;
  const error =
    (personalLessonsEnabled ? queryError(lessonsQuery) : null) ??
    queryError(scheduleQuery) ??
    queryError(disciplinesQuery);

  if (isLoading) return <LoadingState label={t("dashboard.loading")} />;
  if (error) return <QueryErrorState error={error} />;

  const disciplineNames = Object.fromEntries(
    (disciplinesQuery.data ?? []).map((d) => [d.id, d.name])
  );

  return (
    <TeacherScopedDashboard
      personalLessons={lessonsQuery.data ?? []}
      scheduleSlots={scheduleQuery.data ?? []}
      disciplineNames={disciplineNames}
      onNavigate={onNavigate}
    />
  );
}

function OperationalDashboardView({
  showBoth,
  activeTab,
  onTabChange,
  dashboardTabs,
  clientsQuery,
  subscriptionsQuery,
  personalLessonsQuery,
  todayPaymentsQuery,
  showOperationalPayments,
  personalLessonsEnabled,
  onNavigate,
}: {
  showBoth: boolean;
  activeTab: DashboardTab;
  onTabChange: (tab: DashboardTab) => void;
  dashboardTabs: DashboardTabItem[];
  clientsQuery: ReturnType<typeof useClientDirectory>;
  subscriptionsQuery: ReturnType<typeof useSubscriptions>;
  personalLessonsQuery: ReturnType<typeof usePersonalLessons>;
  todayPaymentsQuery: ReturnType<typeof usePayments>;
  showOperationalPayments: boolean;
  personalLessonsEnabled: boolean;
  onNavigate: (panel: string) => void;
}) {
  const { t } = useI18n();
  const isLoading =
    clientsQuery.isLoading ||
    subscriptionsQuery.isLoading ||
    (personalLessonsEnabled && personalLessonsQuery.isLoading) ||
    (showOperationalPayments && todayPaymentsQuery.isLoading);
  const error =
    queryError(clientsQuery) ??
    queryError(subscriptionsQuery) ??
    (personalLessonsEnabled ? queryError(personalLessonsQuery) : null) ??
    (showOperationalPayments ? queryError(todayPaymentsQuery) : null);

  if (isLoading) return <LoadingState label={t("dashboard.loading")} />;
  if (error) return <QueryErrorState error={error} />;

  const content = (
    <OperationalDashboard
      clients={(clientsQuery.data ?? []) as Client[]}
      subscriptions={(subscriptionsQuery.data ?? []) as Subscription[]}
      personalLessons={(personalLessonsQuery.data ?? []) as PersonalLesson[]}
      todayPayments={todayPaymentsQuery.data ?? []}
      showOperationalPayments={showOperationalPayments}
      onNavigate={onNavigate}
    />
  );

  if (!showBoth) return content;

  return (
    <div>
      <PageTabs tabs={dashboardTabs} activeTab={activeTab} onChange={(tab) => onTabChange(tab as DashboardTab)} />
      <div
        role="tabpanel"
        className={`bg-white p-4 border border-slate-200 shadow-xs panel-card-stack ${pageTabPanelCls(activeTab, "operational")}`}
      >
        {content}
      </div>
    </div>
  );
}

function queryError(query: { error: unknown | null; isError: boolean }): Error | null {
  if (!query.isError || query.error == null) return null;
  return query.error instanceof Error ? query.error : new Error(String(query.error));
}
