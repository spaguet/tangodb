import { useNavigate } from "react-router-dom";
import Dashboard from "../components/Dashboard";
import LoadingState from "../components/ui/LoadingState";
import QueryErrorState from "../components/ui/QueryErrorState";
import { useToast } from "../App";
import { useClients } from "../hooks/useClients";
import { useDisciplines } from "../hooks/useDisciplines";
import { usePersonalLessons } from "../hooks/usePersonalLessons";
import { usePrices } from "../hooks/usePrices";
import { useSchedule } from "../hooks/useSchedule";
import { useSubscriptions } from "../hooks/useSubscriptions";
import { useUIStore } from "../store/ui";

export default function DashboardPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const setSubscriptionsTab = useUIStore((s) => s.setSubscriptionsTab);
  const setPersonalTab = useUIStore((s) => s.setPersonalTab);

  const clientsQuery = useClients();
  const subscriptionsQuery = useSubscriptions();
  const scheduleQuery = useSchedule();
  const personalLessonsQuery = usePersonalLessons();
  const pricesQuery = usePrices();
  const disciplinesQuery = useDisciplines();

  const { data: clients = [], isLoading: clientsLoading, isError: clientsError, error: clientsErr } = clientsQuery;
  const { data: subscriptions = [], isLoading: subsLoading, isError: subsError, error: subsErr } = subscriptionsQuery;
  const { data: schedule = [], isLoading: scheduleLoading, isError: scheduleError, error: scheduleErr } = scheduleQuery;
  const { data: personalLessons = [], isLoading: personalLoading, isError: personalError, error: personalErr } = personalLessonsQuery;
  const { data: prices = [], isLoading: pricesLoading, isError: pricesError, error: pricesErr } = pricesQuery;
  const { data: disciplines = [], isLoading: disciplinesLoading, isError: disciplinesError, error: disciplinesErr } = disciplinesQuery;

  const isLoading =
    clientsLoading || subsLoading || scheduleLoading || personalLoading || pricesLoading || disciplinesLoading;
  const isError =
    clientsError || subsError || scheduleError || personalError || pricesError || disciplinesError;
  const error = clientsErr ?? subsErr ?? scheduleErr ?? personalErr ?? pricesErr ?? disciplinesErr;

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

  if (isLoading) return <LoadingState label="Загрузка обзора..." />;
  if (isError) return <QueryErrorState error={error} />;

  return (
    <Dashboard
      clients={clients}
      subscriptions={subscriptions}
      schedule={schedule}
      personalLessons={personalLessons}
      prices={prices}
      disciplines={disciplines}
      toast={toast}
      onNavigate={handleNavigate}
    />
  );
}
