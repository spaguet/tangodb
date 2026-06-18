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
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, req);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Unauthorized" }, 401, req);
  }

  const clientIp = getClientIp(req);
  if (!checkRateLimit(`dev-console-migrations:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const userClient = createUserClient(authHeader);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user || !isDeveloper(userData.user, authHeader)) {
    return jsonResponse({ error: "developer_access_required" }, 403, req);
  }

  let body: { organization_id?: string; limit?: number };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const limit = Math.min(Math.max(body.limit ?? 50, 1), 100);
  const admin = createServiceClient();

  let query = admin
    .from("organization_version_migrations")
    .select(
      "id, organization_id, from_version_id, to_version_id, status, dry_run, started_at, completed_at, error_message, metadata, previous_status, initiated_by"
    )
    .order("started_at", { ascending: false })
    .limit(limit);

  if (body.organization_id) {
    query = query.eq("organization_id", body.organization_id);
  }

  const { data, error } = await query;

  if (error) {
    logEvent("dev_console_migrations_list_error", { code: error.code ?? "unknown" });
    return jsonResponse({ error: "Failed to load migrations" }, 500, req);
  }

  return jsonResponse({ ok: true, migrations: data ?? [] }, 200, req);
});
