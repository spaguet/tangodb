import { useNavigate } from "react-router-dom";
import OperationalDashboard from "../components/OperationalDashboard";
import FinancialDashboard from "../components/FinancialDashboard";
import LoadingState from "../components/ui/LoadingState";
import QueryErrorState from "../components/ui/QueryErrorState";
import { useClientDirectory } from "../hooks/useClients";
import { usePersonalLessons } from "../hooks/usePersonalLessons";
import { useSubscriptions } from "../hooks/useSubscriptions";
import { usePayments } from "../hooks/usePayments";
import { usePermissions } from "../hooks/usePermissions";
import { useUIStore } from "../store/ui";
import { useOrganization } from "../organization/OrganizationProvider";

export default function DashboardPage() {
  const navigate = useNavigate();
  const { orgLoading, organizationId } = useOrganization();
  const setSubscriptionsTab = useUIStore((s) => s.setSubscriptionsTab);
  const setPersonalTab = useUIStore((s) => s.setPersonalTab);
  const { can } = usePermissions();

  const showFinancial = can("reports.financial");
  const showOperational = can("reports.operational") && !showFinancial;

  const clientsQuery = useClientDirectory({ enabled: showOperational });
  const subscriptionsQuery = useSubscriptions({ enabled: showOperational });
  const personalLessonsQuery = usePersonalLessons(undefined, { enabled: showOperational });
  const showOperationalPayments = showOperational && can("payments.read.operational");
  const todayPaymentsQuery = usePayments(
    showOperationalPayments ? { todayOnly: true } : { enabled: false }
  );

  const isLoading =
    showOperational &&
    (clientsQuery.isLoading ||
      subscriptionsQuery.isLoading ||
      personalLessonsQuery.isLoading ||
      (showOperationalPayments && todayPaymentsQuery.isLoading));
  const isError =
    showOperational &&
    (clientsQuery.isError ||
      subscriptionsQuery.isError ||
      personalLessonsQuery.isError ||
      (showOperationalPayments && todayPaymentsQuery.isError));
  const error =
    queryError(clientsQuery) ??
    queryError(subscriptionsQuery) ??
    queryError(personalLessonsQuery) ??
    (showOperationalPayments ? queryError(todayPaymentsQuery) : null);

  const handleNavigate = (panel: string) => {
    const routes: Record<string, { path: string; subTab?: "active" | "sell"; persTab?: "view" | "sell" }> = {
      activeSubs: { path: "/subscriptions", subTab: "active" },
      personalView: { path: "/personal", persTab: "view" },
      attendance: { path: "/attendance" },
    };

    const route = routes[panel] ?? { path: "/" };
    if (route.subTab) setSubscriptionsTab(route.subTab);
    if (route.persTab) setPersonalTab(route.persTab);
    navigate(route.path);
  };

  if (orgLoading || !organizationId) return <LoadingState label="Загрузка организации..." />;
  if (!showFinancial && !showOperational) {
    return (
      <div className="panel-page-stack">
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs py-20 text-center">
          <p className="text-sm text-slate-500">Нет доступа к обзору для вашей роли.</p>
        </div>
      </div>
    );
  }
  if (isLoading) return <LoadingState label="Загрузка обзора..." />;
  if (isError) return <QueryErrorState error={error} />;

  if (showFinancial) {
    return <FinancialDashboard />;
  }

  return (
    <OperationalDashboard
      clients={clientsQuery.data ?? []}
      subscriptions={subscriptionsQuery.data ?? []}
      personalLessons={personalLessonsQuery.data ?? []}
      todayPayments={todayPaymentsQuery.data ?? []}
      showOperationalPayments={showOperationalPayments}
      onNavigate={handleNavigate}
    />
  );
}

function queryError(query: { error: unknown | null; isError: boolean }): Error | null {
  if (!query.isError || query.error == null) return null;
  return query.error instanceof Error ? query.error : new Error(String(query.error));
}
