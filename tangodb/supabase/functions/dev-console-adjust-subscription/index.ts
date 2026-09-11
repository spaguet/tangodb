import { isDeveloperVerified } from "../_shared/devAuth.ts";
import {
  getClientIp,
  handleOptions,
  jsonResponse,
} from "../_shared/http.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createServiceClient, createUserClient, logEvent } from "../_shared/supabase.ts";

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 15 * 60_000;

const VALID_STATUSES = new Set(["active", "past_due", "canceled"]);
const VALID_PROVIDERS = new Set(["manual", "stripe"]);

function asString(value: unknown, max = 300): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function parseIsoDateTime(value: unknown): string | null {
  const raw = asString(value, 64);
  if (!raw) return null;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

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
  if (!(await checkRateLimit(`dev-console-adjust:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS))) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const userClient = createUserClient(authHeader);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user || !(await isDeveloperVerified(userData.user))) {
    return jsonResponse({ error: "developer_access_required" }, 403, req);
  }

  let body: {
    organization_id?: string;
    status?: string;
    provider?: string;
    period_start?: string;
    period_end?: string;
    extend_one_month?: boolean;
    note?: string;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, req);
  }

  const orgId = body.organization_id?.trim();
  const note = asString(body.note, 300);
  if (!orgId) {
    return jsonResponse({ error: "organization_id_required" }, 400, req);
  }
  if (!note) {
    return jsonResponse({ error: "note_required" }, 400, req);
  }

  const status = body.status?.trim();
  if (status && !VALID_STATUSES.has(status)) {
    return jsonResponse({ error: "invalid_status" }, 400, req);
  }

  const provider = body.provider?.trim();
  if (provider && !VALID_PROVIDERS.has(provider)) {
    return jsonResponse({ error: "invalid_provider" }, 400, req);
  }

  const periodStart = parseIsoDateTime(body.period_start);
  const periodEnd = parseIsoDateTime(body.period_end);
  const extendOneMonth = body.extend_one_month === true;

  if (!status && !periodStart && !periodEnd && !extendOneMonth && !provider) {
    return jsonResponse({ error: "no_adjustment_specified" }, 400, req);
  }

  const admin = createServiceClient();

  const { data: result, error: adjustError } = await admin.rpc(
    "dev_console_adjust_organization_subscription",
    {
      p_organization_id: orgId,
      p_actor_id: userData.user.id,
      p_status: status || null,
      p_period_start: periodStart,
      p_period_end: periodEnd,
      p_provider: provider || null,
      p_extend_one_month: extendOneMonth,
      p_note: note,
    }
  );

  if (adjustError) {
    const msg = adjustError.message ?? "";
    logEvent("dev_console_adjust_error", { code: adjustError.code ?? "unknown" });
    if (msg.includes("lifetime_grandfathered")) {
      return jsonResponse({ error: "lifetime_grandfathered" }, 400, req);
    }
    if (msg.includes("manual_active_requires_period") || msg.includes("invalid_period")) {
      return jsonResponse({ error: "invalid_period" }, 400, req);
    }
    return jsonResponse({ error: "Adjust failed" }, 500, req);
  }

  await admin.from("platform_audit_log").insert({
    actor_user_id: userData.user.id,
    action: "billing.manual_adjust",
    target_type: "organization",
    target_id: orgId,
    metadata: {
      note,
      status: status ?? null,
      provider: provider ?? null,
      extend_one_month: extendOneMonth,
      before: (result as { before?: unknown })?.before ?? null,
      after: (result as { after?: unknown })?.after ?? null,
    },
  });

  logEvent("dev_console_billing_adjusted", { organization_id: orgId, status: status ?? "unchanged" });

  return jsonResponse({ ok: true, result }, 200, req);
});
