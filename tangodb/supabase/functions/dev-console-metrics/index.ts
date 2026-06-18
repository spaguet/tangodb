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
  if (!checkRateLimit(`dev-console-metrics:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const userClient = createUserClient(authHeader);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user || !isDeveloper(userData.user)) {
    return jsonResponse({ error: "Forbidden" }, 403, req);
  }

  const admin = createServiceClient();

  const [
    orgCount,
    activeLicensed,
    demoActive,
    demoRetention,
    pendingKeys,
    membersCount,
  ] = await Promise.all([
    admin.from("organizations").select("id", { count: "exact", head: true }),
    admin.from("organizations").select("id", { count: "exact", head: true }).eq("status", "licensed"),
    admin.from("organizations").select("id", { count: "exact", head: true }).eq("status", "demo_active"),
    admin.from("organizations").select("id", { count: "exact", head: true }).eq("status", "demo_retention"),
    admin.from("access_keys").select("id", { count: "exact", head: true }).eq("status", "pending"),
    admin.from("organization_members").select("id", { count: "exact", head: true }).eq("is_active", true),
  ]);

  const { data: dbSizeRow } = await admin.rpc("pg_database_size_bytes").maybeSingle();
  let dbSizeBytes: number | null = null;
  if (typeof dbSizeRow === "number") dbSizeBytes = dbSizeRow;
  else dbSizeBytes = (orgCount.count ?? 0) * 2_000_000;

  logEvent("dev_console_metrics", { org_count: orgCount.count ?? 0 });

  return jsonResponse(
    {
      ok: true,
      metrics: {
        org_count: orgCount.count ?? 0,
        licensed_count: activeLicensed.count ?? 0,
        demo_active_count: demoActive.count ?? 0,
        demo_retention_count: demoRetention.count ?? 0,
        pending_keys_count: pendingKeys.count ?? 0,
        active_members_count: membersCount.count ?? 0,
        db_size_bytes_estimate: dbSizeBytes,
      },
    },
    200,
    req
  );
});
