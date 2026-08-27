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
  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, req);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Unauthorized" }, 401, req);
  }

  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`dev-console-errors:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS))) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const userClient = createUserClient(authHeader);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user || !isDeveloper(userData.user, authHeader)) {
    return jsonResponse({ error: "developer_access_required" }, 403, req);
  }

  let body: { query?: string; limit?: number };
  try {
    body = req.method === "POST" ? await req.json() : {};
  } catch {
    body = {};
  }

  const q = (body.query ?? "").trim();
  const limit = Math.min(Math.max(body.limit ?? 50, 1), 100);
  const ilikeFilter = buildIlikeOrFilter(
    ["action", "target_type", "metadata->>message", "metadata->>code"],
    q
  );
  const admin = createServiceClient();

  let query = admin
    .from("platform_audit_log")
    .select("id, action, target_type, target_id, metadata, created_at, actor_user_id")
    .or("action.ilike.%error%,action.ilike.%rejected%,action.ilike.%failed%")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (ilikeFilter) query = query.or(ilikeFilter);

  const { data, error } = await query;
  if (error) {
    logEvent("dev_console_errors_error", { code: error.code ?? "unknown" });
    return jsonResponse({ error: "Errors search failed" }, 500, req);
  }

  return jsonResponse({ ok: true, errors: data ?? [] }, 200, req);
});
