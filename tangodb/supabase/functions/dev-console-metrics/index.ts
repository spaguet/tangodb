import { isDeveloperVerified } from "../_shared/devAuth.ts";
import { getClientIp, handleOptions, jsonResponse } from "../_shared/http.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createServiceClient, createUserClient, logEvent } from "../_shared/supabase.ts";

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 15 * 60_000;

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
  if (!(await checkRateLimit(`dev-console-metrics:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS))) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const userClient = createUserClient(authHeader);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user || !(await isDeveloperVerified(userData.user))) {
    return jsonResponse({ error: "developer_access_required" }, 403, req);
  }

  const admin = createServiceClient();

  const [editionRes, pendingKeys, membersCount, dbSizeRow] = await Promise.all([
    admin.rpc("dev_console_edition_metrics"),
    admin.from("access_keys").select("id", { count: "exact", head: true }).eq("status", "pending"),
    admin.from("organization_members").select("id", { count: "exact", head: true }).eq("is_active", true),
    admin.rpc("pg_database_size_bytes").maybeSingle(),
  ]);

  if (editionRes.error || !editionRes.data) {
    logEvent("dev_console_metrics_error", { message: editionRes.error?.message ?? "empty" });
    return jsonResponse({ error: "Metrics failed" }, 500, req);
  }

  const edition = editionRes.data as Record<string, number>;
  let dbSizeBytes: number | null = null;
  if (typeof dbSizeRow.data === "number") dbSizeBytes = dbSizeRow.data;
  else dbSizeBytes = (edition.org_count ?? 0) * 2_000_000;

  logEvent("dev_console_metrics", { org_count: edition.org_count ?? 0 });

  return jsonResponse(
    {
      ok: true,
      metrics: {
        org_count: edition.org_count ?? 0,
        licensed_count: edition.status_licensed ?? 0,
        demo_active_count: edition.status_demo_active ?? 0,
        demo_retention_count: edition.status_demo_retention ?? 0,
        suspended_count: edition.status_suspended ?? 0,
        purged_count: edition.status_purged ?? 0,
        edition_lite: edition.edition_lite ?? 0,
        edition_studio: edition.edition_studio ?? 0,
        edition_pro: edition.edition_pro ?? 0,
        live_trial_pro: edition.live_trial_pro ?? 0,
        live_studio_monthly: edition.live_studio_monthly ?? 0,
        live_pro_monthly: edition.live_pro_monthly ?? 0,
        live_pro_lifetime: edition.live_pro_lifetime ?? 0,
        over_cap_lite: edition.over_cap_lite ?? 0,
        pending_keys_count: pendingKeys.count ?? 0,
        active_members_count: membersCount.count ?? 0,
        db_size_bytes_estimate: dbSizeBytes,
      },
    },
    200,
    req
  );
});
