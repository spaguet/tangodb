import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

/** Close popovers/modals when the route changes (avoids stranded `fixed inset-0` layers). */
export function useDismissOnRouteChange(onDismiss: () => void) {
  const location = useLocation();
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    onDismissRef.current();
  }, [location.pathname]);
}
