import ClientsPanel from "../components/ClientsPanel";
import { useToast } from "../App";

export default function ClientsPage() {
  const toast = useToast();
  return <ClientsPanel toast={toast} />;
}
