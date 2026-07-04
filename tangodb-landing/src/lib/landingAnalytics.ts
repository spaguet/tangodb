import type { Locale } from "../i18n";

export const LANDING_EVENTS = {
  PAGEVIEW: "pageview",
  CTA_REGISTER: "cta_register",
  CTA_DEMO: "cta_demo",
  CTA_TELEGRAM: "cta_telegram",
  CTA_LOGIN: "cta_login",
  SCROLL_PRICING: "scroll_pricing",
  SCROLL_FAQ: "scroll_faq",
} as const;

export type LandingEvent = (typeof LANDING_EVENTS)[keyof typeof LANDING_EVENTS];

type TrackPayload = {
  locale?: Locale;
};

const VISITOR_ID_KEY = "tangodb_landing_visitor_id";
const SESSION_ID_KEY = "tangodb_landing_session_id";
const PAGEVIEW_SENT_KEY = "tangodb_landing_pageview_sent";
const SCROLL_PRICING_SENT_KEY = "tangodb_landing_scroll_pricing_sent";
const SCROLL_FAQ_SENT_KEY = "tangodb_landing_scroll_faq_sent";

function getOrCreateId(storage: Storage, key: string): string {
  let id = storage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    storage.setItem(key, id);
  }
  return id;
}

function getUtmParams(): Pick<
  Record<string, string | undefined>,
  "utm_source" | "utm_medium" | "utm_campaign"
> {
  const params = new URLSearchParams(window.location.search);
  const pick = (name: string) => params.get(name)?.trim() || undefined;
  return {
    utm_source: pick("utm_source"),
    utm_medium: pick("utm_medium"),
    utm_campaign: pick("utm_campaign"),
  };
}

function logDebug(message: string): void {
  if (import.meta.env.DEV) {
    console.debug(`[landingAnalytics] ${message}`);
  }
}

async function sendLandingEvent(event: LandingEvent, payload?: TrackPayload): Promise<void> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !anonKey) {
    logDebug("skipped: missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
    return;
  }

  const body = {
    event,
    visitor_id: getOrCreateId(localStorage, VISITOR_ID_KEY),
    session_id: getOrCreateId(sessionStorage, SESSION_ID_KEY),
    path: window.location.pathname + window.location.search + window.location.hash,
    locale: payload?.locale,
    referrer: document.referrer.trim() || undefined,
    ...getUtmParams(),
  };

  try {
    await fetch(`${supabaseUrl}/functions/v1/landing-track-event`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify(body),
      keepalive: true,
    });
  } catch {
    logDebug(`failed to send ${event}`);
  }
}

export function trackLandingEvent(event: LandingEvent, payload?: TrackPayload): void {
  void sendLandingEvent(event, payload);
}

export function onLandingCtaClick(event: LandingEvent, locale?: Locale) {
  return () => {
    trackLandingEvent(event, locale ? { locale } : undefined);
  };
}

export function initLandingAnalytics(locale: Locale): () => void {
  if (!sessionStorage.getItem(PAGEVIEW_SENT_KEY)) {
    trackLandingEvent(LANDING_EVENTS.PAGEVIEW, { locale });
    sessionStorage.setItem(PAGEVIEW_SENT_KEY, "1");
  }

  const observers: IntersectionObserver[] = [];

  const observeScroll = (elementId: string, event: LandingEvent, sentKey: string) => {
    const element = document.getElementById(elementId);
    if (!element || sessionStorage.getItem(sentKey)) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        if (sessionStorage.getItem(sentKey)) return;

        sessionStorage.setItem(sentKey, "1");
        trackLandingEvent(event, { locale });
        observer.disconnect();
      },
      { threshold: 0.2 },
    );

    observer.observe(element);
    observers.push(observer);
  };

  observeScroll("pricing", LANDING_EVENTS.SCROLL_PRICING, SCROLL_PRICING_SENT_KEY);
  observeScroll("faq", LANDING_EVENTS.SCROLL_FAQ, SCROLL_FAQ_SENT_KEY);

  return () => {
    observers.forEach((observer) => observer.disconnect());
  };
}
