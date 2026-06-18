import { useNavigate } from "react-router-dom";
import Dashboard from "../components/Dashboard";
import LoadingState from "../components/ui/LoadingState";
import QueryErrorState from "../components/ui/QueryErrorState";
import { useToast } from "../App";
import { useClientDirectory } from "../hooks/useClients";
import { usePersonalLessons } from "../hooks/usePersonalLessons";
import { usePrices } from "../hooks/usePrices";
import { useSchedule } from "../hooks/useSchedule";
import { useSubscriptions } from "../hooks/useSubscriptions";
import { useUIStore } from "../store/ui";
import { useOrganization } from "../organization/OrganizationProvider";

export default function DashboardPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { orgLoading, organizationId } = useOrganization();
  const setSubscriptionsTab = useUIStore((s) => s.setSubscriptionsTab);
  const setPersonalTab = useUIStore((s) => s.setPersonalTab);

  const clientsQuery = useClientDirectory();
  const subscriptionsQuery = useSubscriptions();
  const scheduleQuery = useSchedule();
  const personalLessonsQuery = usePersonalLessons();
  const pricesQuery = usePrices();

  const { data: clients = [], isLoading: clientsLoading, isError: clientsError, error: clientsErr } = clientsQuery;
  const { data: subscriptions = [], isLoading: subsLoading, isError: subsError, error: subsErr } = subscriptionsQuery;
  const { data: schedule = [], isLoading: scheduleLoading, isError: scheduleError, error: scheduleErr } = scheduleQuery;
  const { data: personalLessons = [], isLoading: personalLoading, isError: personalError, error: personalErr } = personalLessonsQuery;
  const { data: prices = [], isLoading: pricesLoading, isError: pricesError, error: pricesErr } = pricesQuery;

  const isLoading =
    clientsLoading || subsLoading || scheduleLoading || personalLoading || pricesLoading;
  const isError =
    clientsError || subsError || scheduleError || personalError || pricesError;
  const error = clientsErr ?? subsErr ?? scheduleErr ?? personalErr ?? pricesErr;

  const handleNavigate = (panel: string) => {
    const routes: Record<string, { path: string; subTab?: "active" | "sell"; persTab?: "view" | "sell" }> = {
      dashboard: { path: "/" },
      newClient: { path: "/clients" },
      sellSub: { path: "/subscriptions/sell", subTab: "sell" },
      activeSubs: { path: "/subscriptions", subTab: "active" },
      schedule: { path: "/schedule" },
      attendance: { path: "/attendance" },
      personalView: { path: "/personal", persTab: "view" },
      personalSell: { path: "/personal/sell", persTab: "sell" },
      prices: { path: "/prices" },
    };

    const route = routes[panel] ?? { path: "/" };
    if (route.subTab) setSubscriptionsTab(route.subTab);
    if (route.persTab) setPersonalTab(route.persTab);
    navigate(route.path);
  };

  if (orgLoading || !organizationId) return <LoadingState label="Загрузка организации..." />;
  if (isLoading) return <LoadingState label="Загрузка обзора..." />;
  if (isError) return <QueryErrorState error={error} />;

  return (
    <Dashboard
      clients={clients}
      subscriptions={subscriptions}
      schedule={schedule}
      personalLessons={personalLessons}
      prices={prices}
      toast={toast}
      onNavigate={handleNavigate}
    />
  );
}
