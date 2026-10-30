import ClientsPanel from "../ClientsPanel";
import { useToast } from "../../lib/toastContext";

/** Clients — same CRM panel and hooks as desktop. */
export default function PhoneClientsPanel() {
  const toast = useToast();
  return <ClientsPanel toast={toast} />;
}
