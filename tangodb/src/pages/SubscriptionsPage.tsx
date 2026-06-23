import SubscriptionsPanel from "../components/SubscriptionsPanel";
import { useToast } from "../App";

interface SubscriptionsPageProps {
  initialTab: "active" | "sell" | "history";
}

export default function SubscriptionsPage({ initialTab }: SubscriptionsPageProps) {
  const toast = useToast();
  return <SubscriptionsPanel initialTab={initialTab} toast={toast} />;
}
