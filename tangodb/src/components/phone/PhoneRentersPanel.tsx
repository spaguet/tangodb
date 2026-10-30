import { useParams } from "react-router-dom";
import RentersPanel from "../renters/RentersPanel";
import RenterDetailPanel from "../renters/RenterDetailPanel";
import { useToast } from "../../lib/toastContext";

/** Renters and cash rental — same CRM panels as desktop. */
export default function PhoneRentersPanel() {
  const { renterId } = useParams();
  const toast = useToast();

  if (renterId) {
    return <RenterDetailPanel toast={toast} />;
  }

  return <RentersPanel toast={toast} />;
}
