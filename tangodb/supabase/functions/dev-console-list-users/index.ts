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
  if (!(await checkRateLimit(`dev-console-list-users:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS))) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const userClient = createUserClient(authHeader);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user || !isDeveloper(userData.user, authHeader)) {
    return jsonResponse({ error: "developer_access_required" }, 403, req);
  }

  let body: { query?: string; limit?: number };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const query = (body.query ?? "").trim();
  const limit = Math.min(Math.max(body.limit ?? 200, 1), 500);

  const admin = createServiceClient();
  const { data, error } = await admin.rpc("dev_console_registered_users_snapshot", {
    p_query: query || null,
    p_limit: limit,
  });

  if (error) {
    logEvent("dev_console_list_users_error", { message: error.message ?? "unknown" });
    return jsonResponse({ error: "Failed to load users" }, 500, req);
  }

  const payload = (data ?? {}) as {
    users?: unknown[];
    orphan_count?: number;
  };

  return jsonResponse(
    {
      ok: true,
      users: payload.users ?? [],
      orphan_count: payload.orphan_count ?? 0,
    },
    200,
    req
  );
});
