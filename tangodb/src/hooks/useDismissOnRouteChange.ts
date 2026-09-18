import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

export const DISMISS_APP_OVERLAYS_EVENT = "tangodb:dismiss-overlays";

/** Close header/drawer/popover layers before in-app navigation (sync). */
export function dismissAppOverlays() {
  window.dispatchEvent(new Event(DISMISS_APP_OVERLAYS_EVENT));
}

/** Close popovers/modals when the route changes or a navigation CTA asks to dismiss overlays. */
export function useDismissOnRouteChange(onDismiss: () => void) {
  const location = useLocation();
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    onDismissRef.current();
  }, [location.pathname]);

  useEffect(() => {
    const handler = () => onDismissRef.current();
    window.addEventListener(DISMISS_APP_OVERLAYS_EVENT, handler);
    return () => window.removeEventListener(DISMISS_APP_OVERLAYS_EVENT, handler);
  }, []);
}
