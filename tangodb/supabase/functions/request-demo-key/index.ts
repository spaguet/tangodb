import {
  generateAccessKey,
  hashAccessKey,
} from "../_shared/accessKey.ts";
import { sendTransactionalEmail } from "../_shared/email.ts";
import {
  getClientIp,
  handleOptions,
  isValidEmail,
  jsonResponse,
  normalizeEmail,
} from "../_shared/http.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createServiceClient, logEvent } from "../_shared/supabase.ts";

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 15 * 60_000;

async function sendDemoKeyEmail(email: string, key: string): Promise<boolean> {
  const siteUrl = Deno.env.get("SITE_URL") ?? "https://tangodb.vercel.app";
  const subject = "TangoDB — ваш демо-ключ на 30 дней";
  const text =
    `Здравствуйте!\n\n` +
    `Ваш демо-ключ TangoDB: ${key}\n\n` +
    `Зарегистрируйтесь с этим email и активируйте ключ: ${siteUrl}/activate-key\n\n` +
    `Ключ показывается один раз. Демо — 30 дней полного доступа.\n`;

  return sendTransactionalEmail({ to: email, subject, text });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, req);
  }

  const pepper = Deno.env.get("ACCESS_KEY_PEPPER");
  if (!pepper) {
    return jsonResponse({ error: "Service unavailable" }, 500, req);
  }

  const clientIp = getClientIp(req);
  if (!checkRateLimit(`request-demo-key:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, req);
  }

  const email = normalizeEmail(body.email ?? "");
  if (!isValidEmail(email)) {
    return jsonResponse({ error: "Invalid email" }, 400, req);
  }

  if (!checkRateLimit(`request-demo-key:email:${email}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const admin = createServiceClient();

  const { data: existing } = await admin
    .from("access_keys")
    .select("id")
    .eq("key_type", "demo")
    .ilike("email", email)
    .maybeSingle();

  if (existing) {
    return jsonResponse({ error: "Demo key already requested for this email" }, 409, req);
  }

  const { data: version, error: versionError } = await admin
    .from("crm_product_versions")
    .select("id")
    .eq("is_current", true)
    .eq("code", Deno.env.get("CRM_VERSION_CODE") ?? "v2")
    .maybeSingle();

  if (versionError || !version) {
    logEvent("request_demo_key_version_error", { message: versionError?.message ?? "missing" });
    return jsonResponse({ error: "Service unavailable" }, 500, req);
  }

  const plaintextKey = generateAccessKey("demo");
  const keyHash = await hashAccessKey(plaintextKey, pepper);

  const { error: insertError } = await admin.from("access_keys").insert({
    key_hash: keyHash,
    key_type: "demo",
    status: "pending",
    crm_version_id: version.id,
    email,
  });

  if (insertError) {
    if (insertError.code === "23505") {
      return jsonResponse({ error: "Demo key already requested for this email" }, 409, req);
    }
    logEvent("request_demo_key_insert_error", { code: insertError.code ?? "unknown" });
    return jsonResponse({ error: "Service unavailable" }, 500, req);
  }

  const emailSent = await sendDemoKeyEmail(email, plaintextKey);

  logEvent("demo_key_issued", { email_domain: email.split("@")[1] ?? "unknown" });

  return jsonResponse(
    {
      ok: true,
      key: plaintextKey,
      email_sent: emailSent,
      message: emailSent
        ? "Demo key sent to your email"
        : "Demo key generated — save it now, it will not be shown again",
    },
    200,
    req
  );
});
