import { useNavigate } from "react-router-dom";
import Dashboard from "../components/Dashboard";
import { useStore } from "../hooks/PlaceholderStoreContext";

export default function DashboardPage() {
  const store = useStore();
  const navigate = useNavigate();

  const handleNavigate = (panel: string) => {
    const routes: Record<string, string> = {
      dashboard: "/",
      newClient: "/clients",
      sellSub: "/subscriptions/sell",
      activeSubs: "/subscriptions",
      schedule: "/schedule",
      attendance: "/attendance",
      personalView: "/personal",
      personalSell: "/personal/book",
      prices: "/prices",
    };
    navigate(routes[panel] ?? "/");
  };

  if (store.loading) return null;

  return (
    <Dashboard
      clients={store.clients}
      subscriptions={store.subscriptions}
      schedule={store.schedule}
      personalLessons={store.personalLessons}
      onNavigate={handleNavigate}
    />
  );
}
