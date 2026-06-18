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
  if (!checkRateLimit(`dev-console-versions:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const userClient = createUserClient(authHeader);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user || !isDeveloper(userData.user)) {
    return jsonResponse({ error: "Forbidden" }, 403, req);
  }

  const admin = createServiceClient();
  const { data, error } = await admin
    .from("crm_product_versions")
    .select("id, code, name, schema_version, app_url, is_current, released_at, deprecated_at")
    .order("schema_version", { ascending: true });

  if (error) {
    logEvent("dev_console_versions_error", { code: error.code ?? "unknown" });
    return jsonResponse({ error: "Failed to load versions" }, 500, req);
  }

  return jsonResponse({ ok: true, versions: data ?? [] }, 200, req);
});
