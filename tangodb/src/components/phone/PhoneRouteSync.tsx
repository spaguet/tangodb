import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useUIStore } from "../../store/ui";

/** Keeps subscription/personal tabs aligned with URL in the native shell. */
export default function PhoneRouteSync() {
  const location = useLocation();
  const setSubscriptionsTab = useUIStore((s) => s.setSubscriptionsTab);
  const setPersonalTab = useUIStore((s) => s.setPersonalTab);

  useEffect(() => {
    if (location.pathname === "/subscriptions/sell") setSubscriptionsTab("sell");
    else if (location.pathname === "/subscriptions/history") setSubscriptionsTab("history");
    else if (location.pathname === "/subscriptions") setSubscriptionsTab("active");
    else if (location.pathname === "/personal/sell") setPersonalTab("sell");
    else if (location.pathname.startsWith("/personal")) setPersonalTab("view");
  }, [location.pathname, setSubscriptionsTab, setPersonalTab]);

  return null;
}
