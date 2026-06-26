import {
  getClientIp,
  handleOptions,
  isValidEmail,
  jsonResponse,
  normalizeEmail,
} from "../_shared/http.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createServiceClient, createUserClient, logEvent } from "../_shared/supabase.ts";

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60_000;

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
  if (!checkRateLimit(`waitlist:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const userClient = createUserClient(authHeader);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return jsonResponse({ error: "Unauthorized" }, 401, req);
  }

  let body: { email?: string; organization_id?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const email = normalizeEmail(body.email ?? userData.user.email ?? "");
  if (!isValidEmail(email)) {
    return jsonResponse({ error: "Invalid email" }, 400, req);
  }

  const organizationId =
    typeof body.organization_id === "string" && body.organization_id.trim()
      ? body.organization_id.trim()
      : null;

  if (!checkRateLimit(`waitlist:email:${email}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const admin = createServiceClient();
  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const { data: existing } = await admin
    .from("platform_waitlist")
    .select("id")
    .eq("email", email)
    .gte("created_at", since)
    .limit(1);

  if (existing?.length) {
    return jsonResponse({ ok: true, already_registered: true }, 200, req);
  }

  const { error: insertError } = await admin.from("platform_waitlist").insert({
    email,
    organization_id: organizationId,
  });

  if (insertError) {
    logEvent("waitlist_insert_error", { code: insertError.code ?? "unknown" });
    return jsonResponse({ error: "Waitlist failed" }, 500, req);
  }

  logEvent("waitlist_signup", {
    email_domain: email.split("@")[1] ?? null,
    has_org: Boolean(organizationId),
  });

  return jsonResponse({ ok: true }, 200, req);
});
