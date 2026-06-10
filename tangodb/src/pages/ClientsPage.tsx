import ClientsPanel from "../components/ClientsPanel";
import { useStore } from "../hooks/PlaceholderStoreContext";
import { useToast } from "../App";

export default function ClientsPage() {
  const store = useStore();
  const toast = useToast();
  if (store.loading) return null;

  return (
    <ClientsPanel
      clients={store.clients}
      onAddClient={store.addClient}
      onUpdateClient={store.updateClient}
      onDeleteClient={store.deleteClient}
      toast={toast}
    />
  );
}
