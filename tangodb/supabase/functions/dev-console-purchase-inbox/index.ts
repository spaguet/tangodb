import { generateAccessKey, hashAccessKey } from "../_shared/accessKey.ts";
import { isDeveloperVerified } from "../_shared/devAuth.ts";
import { getClientIp, handleOptions, jsonResponse } from "../_shared/http.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createServiceClient, createUserClient, logEvent } from "../_shared/supabase.ts";

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 15 * 60_000;

type InboxAction =
  | "list"
  | "activate"
  | "preview_activate"
  | "close"
  | "pause_addon"
  | "resume_addon"
  | "update_addon_period";

type InboxKindFilter = "lifetime" | "monthly" | "addon" | "all";

interface PurchaseInboxBody {
  action?: InboxAction;
  request_id?: string;
  organization_id?: string;
  note?: string;
  status?: string;
  kind?: InboxKindFilter;
  period_start?: string;
  period_end?: string;
}

function asString(value: unknown, max = 200): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function parseIsoDate(value: unknown): string | null {
  const raw = asString(value, 40);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return raw;
}

function parseIsoDateTime(value: unknown): string | null {
  const raw = asString(value, 64);
  if (!raw) return null;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

function defaultAddonPeriod(): { periodStart: string; periodEnd: string } {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const periodStart = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const periodEnd = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
  return { periodStart, periodEnd };
}

function kindToRequestKind(kind: InboxKindFilter): string | null {
  if (kind === "lifetime") return "crm_license";
  if (kind === "monthly") return "crm_subscription";
  if (kind === "addon") return "renter_miniapp_addon";
  return null;
}

function mapRpcActivateError(message: string, req: Request) {
  const lower = message.toLowerCase();
  if (lower.includes("request_not_found")) {
    return jsonResponse({ error: "request_not_found" }, 404, req);
  }
  if (lower.includes("month_on_lifetime_forbidden") || lower.includes("already_lifetime")) {
    return jsonResponse({ error: "activation_forbidden" }, 400, req);
  }
  if (lower.includes("period_override_note_required")) {
    return jsonResponse({ error: "period_override_note_required" }, 400, req);
  }
  if (lower.includes("invalid_period")) {
    return jsonResponse({ error: "invalid_period" }, 400, req);
  }
  if (lower.includes("request_not_new")) {
    return jsonResponse({ error: "request_not_new" }, 400, req);
  }
  return jsonResponse({ error: "activation_failed" }, 500, req);
}

async function requireDeveloper(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return { error: jsonResponse({ error: "Unauthorized" }, 401, req) };

  const userClient = createUserClient(authHeader);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user || !(await isDeveloperVerified(userData.user))) {
    return { error: jsonResponse({ error: "developer_access_required" }, 403, req) };
  }

  return { user: userData.user };
}

async function upsertMiniappAddon(
  admin: ReturnType<typeof createServiceClient>,
  organizationId: string,
  periodStart: string,
  periodEnd: string,
  status: "active" | "paused"
) {
  if (periodEnd < periodStart) {
    return { error: "invalid_addon_period" as const };
  }

  const now = new Date().toISOString();
  const { error } = await admin.from("organization_addons").upsert(
    {
      organization_id: organizationId,
      addon_code: "renter_miniapp",
      status,
      period_start: periodStart,
      period_end: periodEnd,
      updated_at: now,
    },
    { onConflict: "organization_id,addon_code" }
  );

  if (error) {
    logEvent("dev_console_addon_upsert_failed", { code: error.code ?? "unknown" });
    return { error: "addon_activation_failed" as const };
  }

  return { ok: true as const };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, req);
  }

  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`dev-console-purchase-inbox:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS))) {
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
    const kindFilter = asString(body.kind, 20) as InboxKindFilter;
    const requestKind = kindToRequestKind(kindFilter);

    let query = admin
      .from("platform_purchase_requests")
      .select(
        "id, organization_id, requester_email, organization_name, contact_email, contact_telegram, payment_comment, request_kind, status, email_sent, access_key_id, activated_at, activated_period_start, activated_period_end, closed_at, created_at, updated_at, organization:organizations(status)"
      )
      .order("created_at", { ascending: false })
      .limit(100);

    if (status && status !== "all") query = query.eq("status", status);
    if (requestKind) query = query.eq("request_kind", requestKind);

    const { data, error } = await query;
    if (error) {
      logEvent("dev_console_purchase_inbox_list_failed", { code: error.code ?? "unknown" });
      return jsonResponse({ error: "inbox_list_failed" }, 500, req);
    }

    return jsonResponse({ ok: true, requests: data ?? [] }, 200, req);
  }

  const requestId = asString(body.request_id, 80);

  if (action === "preview_activate") {
    if (!requestId) {
      return jsonResponse({ error: "request_id_required" }, 400, req);
    }

    const { data, error } = await admin.rpc("preview_activate_platform_purchase_request", {
      p_request_id: requestId,
    });

    if (error) {
      logEvent("dev_console_purchase_preview_failed", { code: error.code ?? "unknown" });
      return mapRpcActivateError(error.message ?? "", req);
    }

    return jsonResponse({ ok: true, preview: data }, 200, req);
  }

  if (action === "pause_addon" || action === "resume_addon" || action === "update_addon_period") {
    const organizationId = asString(body.organization_id, 80);
    if (!organizationId) {
      return jsonResponse({ error: "organization_id_required" }, 400, req);
    }

    const { data: existing, error: existingError } = await admin
      .from("organization_addons")
      .select("period_start, period_end, status")
      .eq("organization_id", organizationId)
      .eq("addon_code", "renter_miniapp")
      .maybeSingle();

    if (existingError || !existing) {
      return jsonResponse({ error: "addon_not_found" }, 404, req);
    }

    let periodStart = existing.period_start as string;
    let periodEnd = existing.period_end as string;
    let nextStatus: "active" | "paused" = existing.status as "active" | "paused";

    if (action === "pause_addon") {
      nextStatus = "paused";
    } else if (action === "resume_addon") {
      nextStatus = "active";
    } else {
      const parsedStart = parseIsoDate(body.period_start);
      const parsedEnd = parseIsoDate(body.period_end);
      if (!parsedStart || !parsedEnd) {
        return jsonResponse({ error: "invalid_addon_period" }, 400, req);
      }
      periodStart = parsedStart;
      periodEnd = parsedEnd;
    }

    const upsertResult = await upsertMiniappAddon(
      admin,
      organizationId,
      periodStart,
      periodEnd,
      nextStatus
    );
    if ("error" in upsertResult) {
      return jsonResponse({ error: upsertResult.error }, 400, req);
    }

    await admin.from("platform_audit_log").insert({
      actor_user_id: auth.user.id,
      action: `addon.${action}`,
      target_type: "organization_addon",
      target_id: organizationId,
      metadata: {
        organization_id: organizationId,
        period_start: periodStart,
        period_end: periodEnd,
        status: nextStatus,
        note: asString(body.note, 300) || null,
      },
    });

    return jsonResponse(
      {
        ok: true,
        organization_id: organizationId,
        status: nextStatus,
        period_start: periodStart,
        period_end: periodEnd,
      },
      200,
      req
    );
  }

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

  const requestKind = purchaseRequest.request_kind as string;

  if (requestKind === "renter_miniapp_addon") {
    const defaults = defaultAddonPeriod();
    const periodStart = parseIsoDate(body.period_start) ?? defaults.periodStart;
    const periodEnd = parseIsoDate(body.period_end) ?? defaults.periodEnd;
    const upsertResult = await upsertMiniappAddon(
      admin,
      purchaseRequest.organization_id,
      periodStart,
      periodEnd,
      "active"
    );
    if ("error" in upsertResult) {
      return jsonResponse({ error: upsertResult.error }, 400, req);
    }

    const now = new Date().toISOString();
    const { error: updateRequestError } = await admin
      .from("platform_purchase_requests")
      .update({
        status: "activated",
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
      action: "purchase_request.activate_addon",
      target_type: "platform_purchase_request",
      target_id: requestId,
      metadata: {
        organization_id: purchaseRequest.organization_id,
        addon_code: "renter_miniapp",
        period_start: periodStart,
        period_end: periodEnd,
        note: asString(body.note, 300) || null,
      },
    });

    return jsonResponse(
      {
        ok: true,
        request_kind: requestKind,
        organization_id: purchaseRequest.organization_id,
        period_start: periodStart,
        period_end: periodEnd,
        message: "Mini App add-on activated",
      },
      200,
      req
    );
  }

  const periodStartOverride = parseIsoDateTime(body.period_start);
  const periodEndOverride = parseIsoDateTime(body.period_end);
  const note = asString(body.note, 300) || null;

  let lifetimeKeyHash: string | null = null;
  let plaintextKey: string | null = null;

  if (requestKind === "crm_license") {
    const pepper = Deno.env.get("ACCESS_KEY_PEPPER");
    if (!pepper) {
      return jsonResponse({ error: "Service unavailable" }, 500, req);
    }
    plaintextKey = generateAccessKey("lifetime");
    lifetimeKeyHash = await hashAccessKey(plaintextKey, pepper);
  }

  const recipientEmail =
    purchaseRequest.contact_email || purchaseRequest.requester_email || null;

  const { data: rpcResult, error: rpcError } = await admin.rpc(
    "activate_platform_purchase_request",
    {
      p_request_id: requestId,
      p_actor_id: auth.user.id,
      p_period_start: periodStartOverride,
      p_period_end: periodEndOverride,
      p_note: note,
      p_lifetime_key_hash: lifetimeKeyHash,
      p_lifetime_recipient_email: recipientEmail,
    }
  );

  if (rpcError) {
    logEvent("dev_console_purchase_activate_rpc_failed", {
      code: rpcError.code ?? "unknown",
      kind: requestKind,
    });
    return mapRpcActivateError(rpcError.message ?? "", req);
  }

  const result = rpcResult as Record<string, unknown>;
  const alreadyActivated = result.already_activated === true;

  const auditAction =
    requestKind === "crm_subscription"
      ? "purchase_request.activate_month"
      : "purchase_request.activate_lifetime";

  await admin.from("platform_audit_log").insert({
    actor_user_id: auth.user.id,
    action: auditAction,
    target_type: "platform_purchase_request",
    target_id: requestId,
    metadata: {
      organization_id: purchaseRequest.organization_id,
      request_kind: requestKind,
      already_activated: alreadyActivated,
      activated_period_start: result.activated_period_start ?? null,
      activated_period_end: result.activated_period_end ?? null,
      access_key_id: result.access_key_id ?? null,
      note,
      period_override: periodStartOverride || periodEndOverride ? true : false,
    },
  });

  if (requestKind === "crm_subscription") {
    return jsonResponse(
      {
        ok: true,
        request_kind: requestKind,
        already_activated: alreadyActivated,
        organization_id: purchaseRequest.organization_id,
        period_start: result.activated_period_start,
        period_end: result.activated_period_end,
        message: alreadyActivated ? "Month already activated" : "CRM month activated",
      },
      200,
      req
    );
  }

  return jsonResponse(
    {
      ok: true,
      request_kind: requestKind,
      already_activated: alreadyActivated,
      key: alreadyActivated ? undefined : plaintextKey,
      key_id: result.access_key_id,
      organization_id: purchaseRequest.organization_id,
      message: alreadyActivated ? "Lifetime already activated" : "Lifetime access activated",
    },
    200,
    req
  );
});
