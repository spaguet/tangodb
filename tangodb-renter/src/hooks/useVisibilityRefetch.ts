import { useEffect, useRef } from "react";

/** Refetch callback on window focus and Telegram visibilityChanged — no setInterval. */
export function useVisibilityRefetch(onRefetch: () => void): void {
  const cb = useRef(onRefetch);
  cb.current = onRefetch;

  useEffect(() => {
    const run = () => cb.current();

    const onFocus = () => run();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") run();
    });

    const webApp = window.Telegram?.WebApp;
    const onVisibility = () => run();

    if (webApp && "onEvent" in webApp && typeof webApp.onEvent === "function") {
      webApp.onEvent("visibilityChanged", onVisibility);
      return () => {
        window.removeEventListener("focus", onFocus);
        if (typeof webApp.offEvent === "function") {
          webApp.offEvent("visibilityChanged", onVisibility);
        }
      };
    }

    return () => window.removeEventListener("focus", onFocus);
  }, []);
}
