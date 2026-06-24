import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { BarChart3, TrendingUp } from "lucide-react";
import OperationalDashboard from "../components/OperationalDashboard";
import FinancialDashboard from "../components/FinancialDashboard";
import TeacherScopedDashboard from "../components/TeacherScopedDashboard";
import LoadingState from "../components/ui/LoadingState";
import QueryErrorState from "../components/ui/QueryErrorState";
import PageTabs from "../components/ui/PageTabs";
import { useClientDirectory } from "../hooks/useClients";
import { useDisciplines } from "../hooks/useDisciplines";
import { usePersonalLessons } from "../hooks/usePersonalLessons";
import { useSchedule } from "../hooks/useSchedule";
import { useSubscriptions } from "../hooks/useSubscriptions";
import { usePayments } from "../hooks/usePayments";
import { usePermissions } from "../hooks/usePermissions";
import { useUIStore } from "../store/ui";
import { useOrganization } from "../organization/OrganizationProvider";
import type { Client, Payment, PersonalLesson, Subscription } from "../types";

type DashboardTab = "operational" | "financial";

const DASHBOARD_TABS = [
  { id: "operational", label: "Операционный", icon: BarChart3 },
  { id: "financial", label: "Финансовый", icon: TrendingUp },
] as const;

export default function DashboardPage() {
  const navigate = useNavigate();
  const { orgLoading, organizationId } = useOrganization();
  const setSubscriptionsTab = useUIStore((s) => s.setSubscriptionsTab);
  const { can } = usePermissions();
  const [activeTab, setActiveTab] = useState<DashboardTab>("operational");

  const showFinancial = can("reports.financial");
  const showOperational = can("reports.operational");
  const showBoth = showOperational && showFinancial;
  const showScopedSummary = can("dashboard.scoped_summary");
  const scopedOnly = showScopedSummary && !showOperational && !showFinancial;

  const operationalEnabled = showOperational && (!showBoth || activeTab === "operational");

  const clientsQuery = useClientDirectory({ enabled: operationalEnabled });
  const subscriptionsQuery = useSubscriptions({ enabled: operationalEnabled });
  const personalLessonsQuery = usePersonalLessons({ enabled: operationalEnabled });
  const showOperationalPayments = operationalEnabled && can("payments.read.operational");
  const todayPaymentsQuery = usePayments(
    showOperationalPayments ? { todayOnly: true } : { enabled: false }
  );

  const scopedLessonsQuery = usePersonalLessons({ enabled: scopedOnly });
  const scopedScheduleQuery = useSchedule({ enabled: scopedOnly });
  const disciplinesQuery = useDisciplines({ enabled: scopedOnly });

  const handleNavigate = (panel: string) => {
    const routes: Record<string, { path: string; subTab?: "active" | "sell" }> = {
      activeSubs: { path: "/subscriptions", subTab: "active" },
      personalView: { path: "/personal" },
      attendance: { path: "/attendance" },
      schedule: { path: "/schedule" },
    };

    const route = routes[panel] ?? { path: "/" };
    if (route.subTab) setSubscriptionsTab(route.subTab);
    navigate(route.path);
  };

  if (orgLoading || !organizationId) return <LoadingState label="Загрузка организации..." />;
  if (!showFinancial && !showOperational && !showScopedSummary) {
    return <DashboardNoAccess />;
  }

  if (scopedOnly) {
    return (
      <ScopedDashboardView
        lessonsQuery={scopedLessonsQuery}
        scheduleQuery={scopedScheduleQuery}
        disciplinesQuery={disciplinesQuery}
        onNavigate={handleNavigate}
      />
    );
  }

  if (showFinancial && !showOperational) {
    return <FinancialDashboard />;
  }

  if (showBoth && activeTab === "financial") {
    return (
      <DashboardWithTabs activeTab={activeTab} onTabChange={setActiveTab}>
        <FinancialDashboard />
      </DashboardWithTabs>
    );
  }

  return (
    <OperationalDashboardView
      showBoth={showBoth}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      clientsQuery={clientsQuery}
      subscriptionsQuery={subscriptionsQuery}
      personalLessonsQuery={personalLessonsQuery}
      todayPaymentsQuery={todayPaymentsQuery}
      showOperationalPayments={showOperationalPayments}
      onNavigate={handleNavigate}
    />
  );
}

function DashboardNoAccess() {
  return (
    <div className="panel-page-stack">
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs py-20 text-center">
        <p className="text-sm text-slate-500">Нет доступа к обзору для вашей роли.</p>
      </div>
    </div>
  );
}

function DashboardWithTabs({
  activeTab,
  onTabChange,
  children,
}: {
  activeTab: DashboardTab;
  onTabChange: (tab: DashboardTab) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="panel-page-stack">
      <PageTabs tabs={[...DASHBOARD_TABS]} activeTab={activeTab} onChange={(tab) => onTabChange(tab as DashboardTab)} />
      <div role="tabpanel" className="panel-page-stack">
        {children}
      </div>
    </div>
  );
}

function ScopedDashboardView({
  lessonsQuery,
  scheduleQuery,
  disciplinesQuery,
  onNavigate,
}: {
  lessonsQuery: ReturnType<typeof usePersonalLessons>;
  scheduleQuery: ReturnType<typeof useSchedule>;
  disciplinesQuery: ReturnType<typeof useDisciplines>;
  onNavigate: (panel: string) => void;
}) {
  const isLoading =
    lessonsQuery.isLoading || scheduleQuery.isLoading || disciplinesQuery.isLoading;
  const error =
    queryError(lessonsQuery) ?? queryError(scheduleQuery) ?? queryError(disciplinesQuery);

  if (isLoading) return <LoadingState label="Загрузка обзора..." />;
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
  clientsQuery,
  subscriptionsQuery,
  personalLessonsQuery,
  todayPaymentsQuery,
  showOperationalPayments,
  onNavigate,
}: {
  showBoth: boolean;
  activeTab: DashboardTab;
  onTabChange: (tab: DashboardTab) => void;
  clientsQuery: ReturnType<typeof useClientDirectory>;
  subscriptionsQuery: ReturnType<typeof useSubscriptions>;
  personalLessonsQuery: ReturnType<typeof usePersonalLessons>;
  todayPaymentsQuery: ReturnType<typeof usePayments>;
  showOperationalPayments: boolean;
  onNavigate: (panel: string) => void;
}) {
  const isLoading =
    clientsQuery.isLoading ||
    subscriptionsQuery.isLoading ||
    personalLessonsQuery.isLoading ||
    (showOperationalPayments && todayPaymentsQuery.isLoading);
  const error =
    queryError(clientsQuery) ??
    queryError(subscriptionsQuery) ??
    queryError(personalLessonsQuery) ??
    (showOperationalPayments ? queryError(todayPaymentsQuery) : null);

  if (isLoading) return <LoadingState label="Загрузка обзора..." />;
  if (error) return <QueryErrorState error={error} />;

  const content = (
    <OperationalDashboard
      clients={(clientsQuery.data ?? []) as Client[]}
      subscriptions={(subscriptionsQuery.data ?? []) as Subscription[]}
      personalLessons={(personalLessonsQuery.data ?? []) as PersonalLesson[]}
      todayPayments={(todayPaymentsQuery.data ?? []) as Payment[]}
      showOperationalPayments={showOperationalPayments}
      onNavigate={onNavigate}
    />
  );

  if (!showBoth) return content;

  return (
    <div className="panel-page-stack">
      <PageTabs tabs={[...DASHBOARD_TABS]} activeTab={activeTab} onChange={(tab) => onTabChange(tab as DashboardTab)} />
      <div role="tabpanel" className="panel-page-stack">
        {content}
      </div>
    </div>
  );
}

function queryError(query: { error: unknown | null; isError: boolean }): Error | null {
  if (!query.isError || query.error == null) return null;
  return query.error instanceof Error ? query.error : new Error(String(query.error));
}
