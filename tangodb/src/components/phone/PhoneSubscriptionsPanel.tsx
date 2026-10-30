import { useLocation } from "react-router-dom";
import SubscriptionsPanel from "../SubscriptionsPanel";
import { useToast } from "../../lib/toastContext";

function initialTabFromPath(pathname: string): "active" | "sell" | "history" {
  if (pathname === "/subscriptions/sell") return "sell";
  if (pathname === "/subscriptions/history") return "history";
  return "active";
}

/** Subscriptions list and sale — same CRM UI as desktop; offline sale blocked in panel. */
export default function PhoneSubscriptionsPanel() {
  const toast = useToast();
  const { pathname } = useLocation();
  return <SubscriptionsPanel initialTab={initialTabFromPath(pathname)} toast={toast} />;
}
