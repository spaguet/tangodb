import { isDeveloperVerified } from "../_shared/devAuth.ts";
import { getClientIp, handleOptions, jsonResponse } from "../_shared/http.ts";
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
  if (userError || !userData.user || !(await isDeveloperVerified(userData.user))) {
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

  const admin = createServiceClient();

  const { data: rows, error: searchError } = await admin.rpc("dev_console_search_billing", {
    p_query: q || null,
    p_filter: status || null,
    p_limit: limit,
  });

  if (searchError) {
    logEvent("dev_console_billing_error", { code: searchError.code ?? "unknown" });
    return jsonResponse({ error: "Search failed" }, 500, req);
  }

  return jsonResponse({ ok: true, organizations: rows ?? [] }, 200, req);
});
