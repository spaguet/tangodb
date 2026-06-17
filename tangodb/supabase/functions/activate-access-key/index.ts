import { hashAccessKey } from "../_shared/accessKey.ts";
import {
  getClientIp,
  handleOptions,
  jsonResponse,
} from "../_shared/http.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createUserClient, logEvent } from "../_shared/supabase.ts";

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

  const pepper = Deno.env.get("ACCESS_KEY_PEPPER");
  if (!pepper) {
    return jsonResponse({ error: "Service unavailable" }, 500, req);
  }

  const clientIp = getClientIp(req);
  if (!checkRateLimit(`activate-key:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  let body: { key?: string; org_name?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, req);
  }

  const plaintextKey = (body.key ?? "").trim();
  if (!plaintextKey) {
    return jsonResponse({ error: "Invalid access key" }, 400, req);
  }

  const supabase = createUserClient(authHeader);
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return jsonResponse({ error: "Unauthorized" }, 401, req);
  }

  const email = userData.user.email ?? "";
  if (!checkRateLimit(`activate-key:email:${email || clientIp}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const keyHash = await hashAccessKey(plaintextKey, pepper);
  const orgName = body.org_name?.trim() || null;

  const { data, error } = await supabase.rpc("activate_access_key", {
    p_key_hash: keyHash,
    p_org_name: orgName,
  });

  if (error) {
    const message = error.message ?? "Activation failed";
    if (
      message.includes("invalid access key") ||
      message.includes("different CRM version") ||
      message.includes("email required")
    ) {
      logEvent("activate_key_rejected", { reason: "validation" });
      return jsonResponse({ error: "Invalid access key" }, 400, req);
    }
    logEvent("activate_key_error", { code: error.code ?? "unknown" });
    return jsonResponse({ error: "Activation failed" }, 500, req);
  }

  logEvent("activate_key_success", {
    key_type: typeof data?.key_type === "string" ? data.key_type : "unknown",
    upgraded: Boolean(data?.upgraded),
  });

  return jsonResponse({ ok: true, ...(data as Record<string, unknown>) }, 200, req);
});
