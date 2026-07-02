import {
  getClientIp,
  handleOptions,
  isValidEmail,
  jsonResponse,
  normalizeEmail,
} from "../_shared/http.ts";
import { ownerEmailHash } from "../_shared/emailHash.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createServiceClient, logEvent } from "../_shared/supabase.ts";
import { verifyTurnstileToken } from "../_shared/turnstile.ts";

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 15 * 60_000;
const CHALLENGE_TTL_HOURS = 24;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, req);
  }

  const clientIp = getClientIp(req);
  if (!checkRateLimit(`verify-self-service:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  let body: { email?: string; turnstile_token?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, req);
  }

  const email = normalizeEmail(body.email ?? "");
  if (!isValidEmail(email)) {
    return jsonResponse({ error: "Invalid email" }, 400, req);
  }

  if (!checkRateLimit(`verify-self-service:email:${email}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const turnstile = await verifyTurnstileToken(body.turnstile_token ?? "", clientIp);
  if (!turnstile.ok) {
    logEvent("self_service_turnstile_rejected", { reason: turnstile.error ?? "unknown" });
    return jsonResponse({ error: "Captcha verification failed" }, 400, req);
  }

  let emailHash: string;
  try {
    emailHash = await ownerEmailHash(email);
  } catch (err) {
    logEvent("self_service_hash_error", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return jsonResponse({ error: "Service unavailable" }, 500, req);
  }

  const admin = createServiceClient();

  const { data: isDeveloperEmail, error: developerCheckError } = await admin.rpc(
    "is_platform_developer_email",
    { p_email: email }
  );

  if (developerCheckError) {
    logEvent("self_service_developer_check_error", {
      code: developerCheckError.code ?? "unknown",
    });
    return jsonResponse({ error: "Service unavailable" }, 500, req);
  }

  const skipDemoQuota = isDeveloperEmail === true;

  if (!skipDemoQuota) {
    const { data: retention } = await admin
      .from("demo_owner_retention")
      .select("id")
      .eq("owner_email_hash", emailHash)
      .maybeSingle();

    if (retention) {
      return jsonResponse({ error: "Demo already used for this email" }, 409, req);
    }

    const { data: existingDemoKey } = await admin
      .from("access_keys")
      .select("id")
      .eq("key_type", "demo")
      .ilike("email", email)
      .maybeSingle();

    if (existingDemoKey) {
      return jsonResponse({ error: "Demo already used for this email" }, 409, req);
    }
  }

  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_HOURS * 60 * 60 * 1000).toISOString();
  const { error: insertError } = await admin.from("self_service_demo_challenges").insert({
    owner_email_hash: emailHash,
    expires_at: expiresAt,
  });

  if (insertError) {
    logEvent("self_service_challenge_error", { code: insertError.code ?? "unknown" });
    return jsonResponse({ error: "Service unavailable" }, 500, req);
  }

  logEvent("self_service_challenge_created", {
    email_domain: email.split("@")[1] ?? "unknown",
  });

  return jsonResponse({ ok: true }, 200, req);
});
