import { isDeveloper } from "../_shared/devAuth.ts";
import {
  getClientIp,
  handleOptions,
  jsonResponse,
} from "../_shared/http.ts";
import { buildIlikeOrFilter } from "../_shared/postgrestSearch.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createServiceClient, createUserClient, logEvent } from "../_shared/supabase.ts";

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 15 * 60_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, req);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Unauthorized" }, 401, req);
  }

  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`dev-console-billing:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS))) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const userClient = createUserClient(authHeader);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user || !isDeveloper(userData.user, authHeader)) {
    return jsonResponse({ error: "developer_access_required" }, 403, req);
  }

  let body: { query?: string; status?: string; limit?: number };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const q = (body.query ?? "").trim();
  const status = (body.status ?? "").trim();
  const limit = Math.min(Math.max(body.limit ?? 50, 1), 100);
  const ilikeFilter = buildIlikeOrFilter(["name", "slug"], q);

  const admin = createServiceClient();

  let orgQuery = admin
    .from("organizations")
    .select(
      "id, name, slug, status, created_at, organization_licenses(license_type, activated_at), organization_subscriptions(plan, billing_period, status, provider, current_period_start, current_period_end, provider_subscription_id)"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (ilikeFilter) orgQuery = orgQuery.or(ilikeFilter);

  const { data: orgs, error: orgError } = await orgQuery;
  if (orgError) {
    logEvent("dev_console_billing_error", { code: orgError.code ?? "unknown" });
    return jsonResponse({ error: "Search failed" }, 500, req);
  }

  let rows = (orgs ?? []).map((row) => {
    const license = Array.isArray(row.organization_licenses)
      ? row.organization_licenses[0]
      : row.organization_licenses;
    const subscription = Array.isArray(row.organization_subscriptions)
      ? row.organization_subscriptions[0]
      : row.organization_subscriptions;
    const { organization_licenses: _l, organization_subscriptions: _s, ...rest } = row as Record<
      string,
      unknown
    >;
    return {
      ...rest,
      license_type: (license as { license_type?: string } | null)?.license_type ?? null,
      license_activated_at: (license as { activated_at?: string } | null)?.activated_at ?? null,
      subscription: subscription ?? null,
    };
  });

  if (status) {
    rows = rows.filter((r) => {
      const sub = r.subscription as { status?: string } | null;
      if (status === "lifetime") return r.license_type === "lifetime";
      if (status === "none") return !sub && r.license_type !== "lifetime";
      return sub?.status === status;
    });
  }

  return jsonResponse({ ok: true, organizations: rows }, 200, req);
});
