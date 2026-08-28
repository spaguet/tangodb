import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
          theme?: "light" | "dark" | "auto";
        }
      ) => string;
      remove: (widgetId: string) => void;
    };
  }
}

const TURNSTILE_SCRIPT_ID = "cf-turnstile-script";
const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;

export function isTurnstileConfigured(): boolean {
  return Boolean(SITE_KEY);
}

export function goTrueCaptchaToken(token: string | null | undefined): string | undefined {
  if (!isTurnstileConfigured()) return undefined;
  const value = token?.trim();
  if (!value) return undefined;
  return value;
}

interface TurnstileWidgetProps {
  onToken: (token: string | null) => void;
  resetKey?: number;
}

export default function TurnstileWidget({ onToken, resetKey = 0 }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    onTokenRef.current(null);
    if (!SITE_KEY) return;

    let cancelled = false;

    async function mount() {
      try {
        if (!window.turnstile) {
          await new Promise<void>((resolve, reject) => {
            const existing = document.getElementById(TURNSTILE_SCRIPT_ID);
            if (existing) {
              existing.addEventListener("load", () => resolve(), { once: true });
              existing.addEventListener("error", () => reject(new Error("load")), { once: true });
              return;
            }
            const script = document.createElement("script");
            script.id = TURNSTILE_SCRIPT_ID;
            script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
            script.async = true;
            script.defer = true;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error("load"));
            document.head.appendChild(script);
          });
        }
        if (cancelled || !containerRef.current || !window.turnstile) return;
        if (widgetIdRef.current) {
          window.turnstile.remove(widgetIdRef.current);
          widgetIdRef.current = null;
        }
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: SITE_KEY!,
          theme: "dark",
          callback: (token) => onTokenRef.current(token),
          "expired-callback": () => onTokenRef.current(null),
          "error-callback": () => onTokenRef.current(null),
        });
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    }

    void mount();
    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [resetKey]);

  if (!SITE_KEY) {
    return <p className="text-xs text-slate-500">Captcha is disabled (missing VITE_TURNSTILE_SITE_KEY).</p>;
  }
  if (loadFailed) {
    return <p className="text-xs text-rose-400">Failed to load captcha</p>;
  }
  return <div ref={containerRef} className="min-h-[65px]" />;
}
