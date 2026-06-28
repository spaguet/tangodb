import { generateAccessKey, hashAccessKey } from "../_shared/accessKey.ts";
import { isDeveloper } from "../_shared/devAuth.ts";
import { getClientIp, handleOptions, jsonResponse } from "../_shared/http.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createServiceClient, createUserClient, logEvent } from "../_shared/supabase.ts";

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 15 * 60_000;

type InboxAction = "list" | "activate" | "close";

interface PurchaseInboxBody {
  action?: InboxAction;
  request_id?: string;
  note?: string;
  status?: string;
}

function asString(value: unknown, max = 200): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function requireDeveloper(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return { error: jsonResponse({ error: "Unauthorized" }, 401, req) };

  const userClient = createUserClient(authHeader);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user || !isDeveloper(userData.user, authHeader)) {
    return { error: jsonResponse({ error: "developer_access_required" }, 403, req) };
  }

  return { user: userData.user };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, req);
  }

  const clientIp = getClientIp(req);
  if (!checkRateLimit(`dev-console-purchase-inbox:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const auth = await requireDeveloper(req);
  if (auth.error) return auth.error;

  let body: PurchaseInboxBody;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const action = body.action ?? "list";
  const admin = createServiceClient();

  if (action === "list") {
    const status = asString(body.status, 40);
    let query = admin
      .from("platform_purchase_requests")
      .select(
        "id, organization_id, requester_email, organization_name, contact_email, contact_telegram, payment_comment, status, email_sent, access_key_id, activated_at, closed_at, created_at, updated_at, organization:organizations(status)"
      )
      .order("created_at", { ascending: false })
      .limit(100);

    if (status && status !== "all") query = query.eq("status", status);

    const { data, error } = await query;
    if (error) {
      logEvent("dev_console_purchase_inbox_list_failed", { code: error.code ?? "unknown" });
      return jsonResponse({ error: "inbox_list_failed" }, 500, req);
    }

    return jsonResponse({ ok: true, requests: data ?? [] }, 200, req);
  }

  const requestId = asString(body.request_id, 80);
  if (!requestId) {
    return jsonResponse({ error: "request_id_required" }, 400, req);
  }

  const { data: purchaseRequest, error: requestError } = await admin
    .from("platform_purchase_requests")
    .select("*")
    .eq("id", requestId)
    .maybeSingle();

  if (requestError || !purchaseRequest) {
    return jsonResponse({ error: "request_not_found" }, 404, req);
  }

  if (action === "close") {
    const now = new Date().toISOString();
    const { error: closeError } = await admin
      .from("platform_purchase_requests")
      .update({ status: "closed", closed_at: now, updated_at: now })
      .eq("id", requestId);

    if (closeError) {
      logEvent("dev_console_purchase_close_failed", { code: closeError.code ?? "unknown" });
      return jsonResponse({ error: "close_failed" }, 500, req);
    }

    await admin.from("platform_audit_log").insert({
      actor_user_id: auth.user.id,
      action: "purchase_request.close",
      target_type: "platform_purchase_request",
      target_id: requestId,
      metadata: {
        organization_id: purchaseRequest.organization_id,
        note: asString(body.note, 300) || null,
      },
    });

    return jsonResponse({ ok: true }, 200, req);
  }

  if (action !== "activate") {
    return jsonResponse({ error: "unknown_action" }, 400, req);
  }

  if (purchaseRequest.status === "activated") {
    return jsonResponse({ error: "request_already_activated" }, 400, req);
  }

  const pepper = Deno.env.get("ACCESS_KEY_PEPPER");
  if (!pepper) {
    return jsonResponse({ error: "Service unavailable" }, 500, req);
  }

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
  const now = new Date().toISOString();
  const recipientEmail = purchaseRequest.contact_email || purchaseRequest.requester_email || null;

  const { data: keyRow, error: keyError } = await admin
    .from("access_keys")
    .insert({
      key_hash: keyHash,
      key_type: "lifetime",
      status: "consumed",
      crm_version_id: version.id,
      email: recipientEmail,
      organization_id: purchaseRequest.organization_id,
      activated_at: now,
      created_by: auth.user.id,
    })
    .select("id")
    .single();

  if (keyError || !keyRow) {
    logEvent("dev_console_purchase_key_failed", { code: keyError?.code ?? "unknown" });
    return jsonResponse({ error: "activation_key_failed" }, 500, req);
  }

  const { error: orgError } = await admin
    .from("organizations")
    .update({
      status: "licensed",
      access_key_id: keyRow.id,
      data_purge_at: null,
      demo_expires_at: null,
    })
    .eq("id", purchaseRequest.organization_id);

  if (orgError) {
    logEvent("dev_console_purchase_org_failed", { code: orgError.code ?? "unknown" });
    return jsonResponse({ error: "organization_activation_failed" }, 500, req);
  }

  const { error: licenseError } = await admin
    .from("organization_licenses")
    .upsert(
      {
        organization_id: purchaseRequest.organization_id,
        crm_version_id: version.id,
        license_type: "lifetime",
        access_key_id: keyRow.id,
        activated_at: now,
        expires_at: null,
      },
      { onConflict: "organization_id" }
    );

  if (licenseError) {
    logEvent("dev_console_purchase_license_failed", { code: licenseError.code ?? "unknown" });
    return jsonResponse({ error: "license_activation_failed" }, 500, req);
  }

  const { error: updateRequestError } = await admin
    .from("platform_purchase_requests")
    .update({
      status: "activated",
      access_key_id: keyRow.id,
      activated_by: auth.user.id,
      activated_at: now,
      updated_at: now,
    })
    .eq("id", requestId);

  if (updateRequestError) {
    logEvent("dev_console_purchase_request_update_failed", {
      code: updateRequestError.code ?? "unknown",
    });
  }

  await admin.from("platform_audit_log").insert({
    actor_user_id: auth.user.id,
    action: "purchase_request.activate_lifetime",
    target_type: "platform_purchase_request",
    target_id: requestId,
    metadata: {
      organization_id: purchaseRequest.organization_id,
      access_key_id: keyRow.id,
      recipient_domain: recipientEmail?.split("@")[1] ?? null,
      note: asString(body.note, 300) || null,
    },
  });

  return jsonResponse(
    {
      ok: true,
      key: plaintextKey,
      key_id: keyRow.id,
      organization_id: purchaseRequest.organization_id,
      message: "Lifetime access activated",
    },
    200,
    req
  );
});
