import { isDeveloper } from "../_shared/devAuth.ts";
import {
  getClientIp,
  handleOptions,
  jsonResponse,
} from "../_shared/http.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createServiceClient, createUserClient, logEvent } from "../_shared/supabase.ts";

const RATE_LIMIT = 5;
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
  if (!checkRateLimit(`dev-console-cleanup-orphans:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const userClient = createUserClient(authHeader);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user || !isDeveloper(userData.user, authHeader)) {
    return jsonResponse({ error: "developer_access_required" }, 403, req);
  }

  let body: { dry_run?: boolean; confirm?: string; user_ids?: string[] };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const dryRun = body.dry_run !== false;
  const confirm = (body.confirm ?? "").trim();
  const userIds = Array.isArray(body.user_ids)
    ? body.user_ids.filter((id): id is string => typeof id === "string" && id.trim() !== "")
    : undefined;

  if (!dryRun && confirm !== "DELETE ORPHAN USERS") {
    return jsonResponse({ error: "confirm_phrase_required" }, 400, req);
  }

  if (!dryRun && (!userIds || userIds.length === 0)) {
    return jsonResponse({ error: "no_users_selected" }, 400, req);
  }

  const admin = createServiceClient();
  const { data, error } = await admin.rpc("dev_console_cleanup_orphan_auth_users", {
    p_actor_user_id: userData.user.id,
    p_dry_run: dryRun,
    p_user_ids: userIds ?? null,
  });

  if (error) {
    const message = error.message ?? "unknown";
    logEvent("dev_console_cleanup_orphans_error", { message });
    return jsonResponse({ error: message }, 500, req);
  }

  logEvent("dev_console_cleanup_orphans", {
    dry_run: dryRun,
    count: (data as { count?: number })?.count ?? 0,
  });

  return jsonResponse({ ok: true, ...(data as Record<string, unknown>) }, 200, req);
});
