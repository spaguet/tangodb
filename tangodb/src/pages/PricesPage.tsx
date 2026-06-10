import PricesPanel from "../components/PricesPanel";
import { useStore } from "../hooks/PlaceholderStoreContext";
import { useToast } from "../App";

export default function PricesPage() {
  const store = useStore();
  const toast = useToast();
  if (store.loading) return null;

  return (
    <PricesPanel prices={store.prices} onUpdatePrice={store.updatePrice} toast={toast} />
  );
}
