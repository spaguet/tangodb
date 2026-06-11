import PricesPanel from "../components/PricesPanel";
import { useToast } from "../App";

export default function PricesPage() {
  const toast = useToast();
  return <PricesPanel toast={toast} />;
}
