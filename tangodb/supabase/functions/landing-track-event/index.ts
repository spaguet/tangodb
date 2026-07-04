import {
  getClientIp,
  handleOptions,
  jsonResponse,
} from "../_shared/http.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createServiceClient, logEvent } from "../_shared/supabase.ts";

const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 15 * 60_000;

const ALLOWED_EVENTS = new Set([
  "pageview",
  "cta_register",
  "cta_demo",
  "cta_telegram",
  "cta_login",
  "scroll_pricing",
  "scroll_faq",
]);

interface TrackEventBody {
  event?: string;
  visitor_id?: string;
  session_id?: string;
  path?: string;
  locale?: string;
  referrer?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
}

function trimText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function requireText(value: unknown, max: number): string | null {
  const text = trimText(value, max);
  return text && text.length > 0 ? text : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, req);
  }

  const clientIp = getClientIp(req);
  if (!checkRateLimit(`landing-track-event:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return jsonResponse({ ok: true }, 200, req);
  }

  let body: TrackEventBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: true }, 200, req);
  }

  const event = trimText(body.event, 64);
  if (!event || !ALLOWED_EVENTS.has(event)) {
    return jsonResponse({ ok: true }, 200, req);
  }

  const visitorId = requireText(body.visitor_id, 128);
  const path = requireText(body.path, 512);
  if (!visitorId || !path) {
    return jsonResponse({ ok: true }, 200, req);
  }

  try {
    const admin = createServiceClient();
    const { error } = await admin.from("landing_events").insert({
      event,
      visitor_id: visitorId,
      session_id: trimText(body.session_id, 128),
      path,
      locale: trimText(body.locale, 16),
      referrer: trimText(body.referrer, 2048),
      utm_source: trimText(body.utm_source, 256),
      utm_medium: trimText(body.utm_medium, 256),
      utm_campaign: trimText(body.utm_campaign, 256),
    });

    if (error) {
      logEvent("landing_track_event_insert_error", {
        code: error.code ?? "unknown",
        event,
      });
    }
  } catch (err) {
    logEvent("landing_track_event_error", {
      message: err instanceof Error ? err.message : "unknown",
    });
  }

  return jsonResponse({ ok: true }, 200, req);
});
