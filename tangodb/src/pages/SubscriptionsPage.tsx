import SubscriptionsPanel from "../components/SubscriptionsPanel";
import { useStore } from "../hooks/PlaceholderStoreContext";
import { useToast } from "../App";

interface SubscriptionsPageProps {
  initialTab: "active" | "sell";
}

export default function SubscriptionsPage({ initialTab }: SubscriptionsPageProps) {
  const store = useStore();
  const toast = useToast();
  if (store.loading) return null;

  return (
    <SubscriptionsPanel
      initialTab={initialTab}
      clients={store.clients}
      subscriptions={store.subscriptions}
      prices={store.prices}
      onAddSubscription={store.addSubscription}
      onFinishSubscription={store.finishSubscription}
      toast={toast}
    />
  );
}
