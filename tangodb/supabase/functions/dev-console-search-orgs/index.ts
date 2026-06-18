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
  if (!checkRateLimit(`dev-console-orgs:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const userClient = createUserClient(authHeader);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user || !isDeveloper(userData.user)) {
    return jsonResponse({ error: "Forbidden" }, 403, req);
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
  let query = admin
    .from("organizations")
    .select("id, name, slug, status, demo_expires_at, data_purge_at, created_at, owner_user_id")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) query = query.eq("status", status);
  if (q) query = query.or(`name.ilike.%${q}%,slug.ilike.%${q}%`);

  const { data, error } = await query;

  if (error) {
    logEvent("dev_console_orgs_error", { code: error.code ?? "unknown" });
    return jsonResponse({ error: "Search failed" }, 500, req);
  }

  return jsonResponse({ ok: true, organizations: data ?? [] }, 200, req);
});
