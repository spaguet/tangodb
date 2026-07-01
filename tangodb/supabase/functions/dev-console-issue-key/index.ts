import {
  generateAccessKey,
  hashAccessKey,
} from "../_shared/accessKey.ts";
import { validateIssuerSignature } from "../_shared/issuerSignature.ts";
import { isDeveloper } from "../_shared/devAuth.ts";
import {
  getClientIp,
  handleOptions,
  isValidEmail,
  jsonResponse,
  normalizeEmail,
} from "../_shared/http.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createServiceClient, createUserClient, logEvent } from "../_shared/supabase.ts";

const RATE_LIMIT = 10;
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
  if (!checkRateLimit(`dev-console-issue:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const userClient = createUserClient(authHeader);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user || !isDeveloper(userData.user, authHeader)) {
    return jsonResponse({ error: "developer_access_required" }, 403, req);
  }

  let body: { email?: string; invoice_ref?: string; note?: string; issuer_signature?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, req);
  }

  const signatureResult = await validateIssuerSignature(body.issuer_signature ?? "");
  if (!signatureResult.ok) {
    return jsonResponse({ error: signatureResult.error }, 403, req);
  }

  const email = normalizeEmail(body.email ?? "");
  if (!isValidEmail(email)) {
    return jsonResponse({ error: "recipient_email_required" }, 400, req);
  }

  const admin = createServiceClient();
  const versionCode = Deno.env.get("CRM_VERSION_CODE") ?? "v2";

  const { data: version, error: versionError } = await admin
    .from("crm_product_versions")
    .select("id")
    .eq("is_current", true)
    .eq("code", versionCode)
    .maybeSingle();

  if (versionError || !version) {
    return jsonResponse({ error: "Service unavailable" }, 500, req);
  }

  const plaintextKey = generateAccessKey("lifetime");
  const keyHash = await hashAccessKey(plaintextKey, pepper);

  const { data: keyRow, error: insertError } = await admin
    .from("access_keys")
    .insert({
      key_hash: keyHash,
      key_type: "lifetime",
      status: "pending",
      crm_version_id: version.id,
      email,
      issuer_signature_hash: signatureResult.hash,
      created_by: userData.user.id,
    })
    .select("id")
    .single();

  if (insertError) {
    logEvent("dev_console_issue_error", { code: insertError.code ?? "unknown" });
    return jsonResponse({ error: "Issue failed" }, 500, req);
  }

  await admin.from("platform_audit_log").insert({
    actor_user_id: userData.user.id,
    action: "key.issue_manual_payment",
    target_type: "access_key",
    target_id: keyRow.id,
    metadata: {
      invoice_ref: body.invoice_ref?.slice(0, 100) ?? null,
      note: body.note?.slice(0, 200) ?? null,
      recipient_domain: email.split("@")[1] ?? null,
    },
  });

  const siteUrl = Deno.env.get("SITE_URL") ?? "https://tangodb.vercel.app";
  logEvent("dev_console_manual_issue", { key_id: keyRow.id });

  return jsonResponse(
    {
      ok: true,
      key: plaintextKey,
      key_id: keyRow.id,
      email,
      activate_url: `${siteUrl}/activate-key`,
      message: "Lifetime key issued — deliver to customer securely",
    },
    200,
    req
  );
});
