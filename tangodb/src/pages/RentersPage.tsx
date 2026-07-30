import { useParams } from "react-router-dom";
import RentersPanel from "../components/renters/RentersPanel";
import RenterDetailPanel from "../components/renters/RenterDetailPanel";
import { useToast } from "../App";

export default function RentersPage() {
  const { renterId } = useParams();
  const toast = useToast();

  if (renterId) {
    return <RenterDetailPanel toast={toast} />;
  }

  return <RentersPanel toast={toast} />;
}
