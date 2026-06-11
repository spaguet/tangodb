import { useNavigate } from "react-router-dom";
import Dashboard from "../components/Dashboard";
import { useClients } from "../hooks/useClients";
import { usePersonalLessons } from "../hooks/usePersonalLessons";
import { useSchedule } from "../hooks/useSchedule";
import { useSubscriptions } from "../hooks/useSubscriptions";
import { useUIStore } from "../store/ui";

export default function DashboardPage() {
  const navigate = useNavigate();
  const setSubscriptionsTab = useUIStore((s) => s.setSubscriptionsTab);
  const setPersonalTab = useUIStore((s) => s.setPersonalTab);

  const { data: clients = [], isLoading: clientsLoading } = useClients();
  const { data: subscriptions = [], isLoading: subsLoading } = useSubscriptions();
  const { data: schedule = [], isLoading: scheduleLoading } = useSchedule();
  const { data: personalLessons = [], isLoading: personalLoading } = usePersonalLessons();

  const isLoading = clientsLoading || subsLoading || scheduleLoading || personalLoading;

  const handleNavigate = (panel: string) => {
    const routes: Record<string, { path: string; subTab?: "active" | "sell"; persTab?: "view" | "book" }> = {
      dashboard: { path: "/" },
      newClient: { path: "/clients" },
      sellSub: { path: "/subscriptions/sell", subTab: "sell" },
      activeSubs: { path: "/subscriptions", subTab: "active" },
      schedule: { path: "/schedule" },
      attendance: { path: "/attendance" },
      personalView: { path: "/personal", persTab: "view" },
      personalSell: { path: "/personal/book", persTab: "book" },
      prices: { path: "/prices" },
    };

    const route = routes[panel] ?? { path: "/" };
    if (route.subTab) setSubscriptionsTab(route.subTab);
    if (route.persTab) setPersonalTab(route.persTab);
    navigate(route.path);
  };

  if (isLoading) return null;

  return (
    <Dashboard
      clients={clients}
      subscriptions={subscriptions}
      schedule={schedule}
      personalLessons={personalLessons}
      onNavigate={handleNavigate}
    />
  );
}
