import { isDeveloper } from "../_shared/devAuth.ts";
import {
  getClientIp,
  handleOptions,
  jsonResponse,
} from "../_shared/http.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createServiceClient, createUserClient, logEvent } from "../_shared/supabase.ts";

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 15 * 60_000;

const PERIODS = {
  "7d": 7,
  "30d": 30,
  "365d": 365,
} as const;

type Period = keyof typeof PERIODS;

interface EventRow {
  event: string;
  visitor_id: string;
  referrer: string | null;
  created_at: string;
}

function parsePeriod(value: unknown): Period {
  if (typeof value === "string" && value in PERIODS) return value as Period;
  return "30d";
}

function periodStartIso(period: Period): string {
  const days = PERIODS[period];
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function fetchEventsInPeriod(startIso: string): Promise<EventRow[]> {
  const admin = createServiceClient();
  const pageSize = 1000;
  let offset = 0;
  const all: EventRow[] = [];

  while (true) {
    const { data, error } = await admin
      .from("landing_events")
      .select("event, visitor_id, referrer, created_at")
      .gte("created_at", startIso)
      .order("created_at", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) throw error;
    if (!data?.length) break;

    all.push(...(data as EventRow[]));
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return all;
}

async function fetchOrgMetrics(startIso: string) {
  const admin = createServiceClient();

  const { count: newDemoOrgs, error: newOrgsError } = await admin
    .from("organizations")
    .select("id", { count: "exact", head: true })
    .gte("created_at", startIso)
    .in("status", ["demo_active", "demo_retention", "licensed"]);

  if (newOrgsError) throw newOrgsError;

  const { count: demoActiveNew, error: demoActiveError } = await admin
    .from("organizations")
    .select("id", { count: "exact", head: true })
    .gte("created_at", startIso)
    .eq("status", "demo_active");

  if (demoActiveError) throw demoActiveError;

  return {
    new_demo_orgs: newDemoOrgs ?? 0,
    demo_active_new_in_period: demoActiveNew ?? 0,
  };
}

function aggregate(
  events: EventRow[],
  period: Period,
  orgMetrics: { new_demo_orgs: number; demo_active_new_in_period: number },
) {
  const countsByEvent: Record<string, number> = {};
  const pageviewVisitors = new Set<string>();
  const referrerCounts = new Map<string, number>();
  const dailyMap = new Map<string, { pageviews: number; cta_register: number }>();

  for (const row of events) {
    countsByEvent[row.event] = (countsByEvent[row.event] ?? 0) + 1;

    if (row.event === "pageview") {
      pageviewVisitors.add(row.visitor_id);
      const ref = row.referrer?.trim() || "(direct)";
      referrerCounts.set(ref, (referrerCounts.get(ref) ?? 0) + 1);

      const day = row.created_at.slice(0, 10);
      const daily = dailyMap.get(day) ?? { pageviews: 0, cta_register: 0 };
      daily.pageviews += 1;
      dailyMap.set(day, daily);
    }

    if (row.event === "cta_register") {
      const day = row.created_at.slice(0, 10);
      const daily = dailyMap.get(day) ?? { pageviews: 0, cta_register: 0 };
      daily.cta_register += 1;
      dailyMap.set(day, daily);
    }
  }

  const pageviews = countsByEvent.pageview ?? 0;
  const uniqueVisitors = pageviewVisitors.size;
  const ctaRegister = countsByEvent.cta_register ?? 0;
  const ctaDemo = countsByEvent.cta_demo ?? 0;
  const ctaTelegram = countsByEvent.cta_telegram ?? 0;
  const ctaLogin = countsByEvent.cta_login ?? 0;
  const { new_demo_orgs, demo_active_new_in_period } = orgMetrics;

  const topReferrers = [...referrerCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([referrer, count]) => ({ referrer, pageviews: count }));

  const daily = [...dailyMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, values]) => ({ date, ...values }));

  const registerCtr = uniqueVisitors > 0 ? ctaRegister / uniqueVisitors : null;
  const trialStartConversion = ctaRegister > 0 ? new_demo_orgs / ctaRegister : null;

  return {
    period,
    pageviews,
    unique_visitors: uniqueVisitors,
    new_demo_orgs,
    demo_active_new_in_period,
    counts_by_event: countsByEvent,
    top_referrers: topReferrers,
    daily,
    funnel: {
      unique_visitors: uniqueVisitors,
      register_clicks: ctaRegister,
      new_demo_orgs,
      register_ctr: registerCtr,
      trial_start_conversion: trialStartConversion,
    },
    rates: {
      register_ctr: registerCtr,
      trial_start_conversion: trialStartConversion,
      demo_distraction_ratio: ctaRegister > 0 ? ctaDemo / ctaRegister : null,
      telegram_intent_rate: uniqueVisitors > 0 ? ctaTelegram / uniqueVisitors : null,
      login_confusion_rate: uniqueVisitors > 0 ? ctaLogin / uniqueVisitors : null,
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, req);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Unauthorized" }, 401, req);
  }

  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`dev-console-landing-analytics:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS))) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const userClient = createUserClient(authHeader);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user || !isDeveloper(userData.user, authHeader)) {
    return jsonResponse({ error: "developer_access_required" }, 403, req);
  }

  let body: { period?: string } = {};
  if (req.method === "POST") {
    try {
      body = await req.json();
    } catch {
      body = {};
    }
  } else {
    const url = new URL(req.url);
    const periodParam = url.searchParams.get("period");
    if (periodParam) body.period = periodParam;
  }

  const period = parsePeriod(body.period);

  try {
    const startIso = periodStartIso(period);
    const [events, orgMetrics] = await Promise.all([
      fetchEventsInPeriod(startIso),
      fetchOrgMetrics(startIso),
    ]);
    const analytics = aggregate(events, period, orgMetrics);

    logEvent("dev_console_landing_analytics", {
      period,
      pageviews: analytics.pageviews,
      unique_visitors: analytics.unique_visitors,
      new_demo_orgs: analytics.new_demo_orgs,
    });

    return jsonResponse({ ok: true, analytics }, 200, req);
  } catch (err) {
    logEvent("dev_console_landing_analytics_error", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return jsonResponse({ error: "failed_to_load_analytics" }, 500, req);
  }
});
