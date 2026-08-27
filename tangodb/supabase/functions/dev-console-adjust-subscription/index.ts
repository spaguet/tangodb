import { isDeveloper } from "../_shared/devAuth.ts";
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
  if (userError || !userData.user || !isDeveloper(userData.user, authHeader)) {
    return jsonResponse({ error: "developer_access_required" }, 403, req);
  }

  let body: {
    organization_id?: string;
    status?: string;
    note?: string;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, req);
  }

  const orgId = body.organization_id?.trim();
  const status = body.status?.trim();
  if (!orgId || !status || !VALID_STATUSES.has(status)) {
    return jsonResponse({ error: "Invalid organization_id or status" }, 400, req);
  }

  const admin = createServiceClient();

  const { data: sub, error: subError } = await admin
    .from("organization_subscriptions")
    .select("*")
    .eq("organization_id", orgId)
    .maybeSingle();

  if (subError || !sub) {
    return jsonResponse({ error: "Subscription not found" }, 404, req);
  }

  const { data: result, error: syncError } = await admin.rpc("sync_organization_subscription", {
    p_organization_id: orgId,
    p_plan: sub.plan,
    p_billing_period: sub.billing_period,
    p_status: status,
    p_provider: sub.provider,
    p_provider_customer_id: sub.provider_customer_id,
    p_provider_subscription_id: sub.provider_subscription_id,
    p_current_period_start: sub.current_period_start,
    p_current_period_end: sub.current_period_end,
    p_event_id: null,
    p_event_type: "dev_console.manual_adjust",
  });

  if (syncError) {
    logEvent("dev_console_adjust_error", { code: syncError.code ?? "unknown" });
    return jsonResponse({ error: "Adjust failed" }, 500, req);
  }

  await admin.from("platform_audit_log").insert({
    actor_user_id: userData.user.id,
    action: "billing.manual_adjust",
    target_type: "organization",
    target_id: orgId,
    metadata: {
      new_status: status,
      note: body.note?.slice(0, 200) ?? null,
      provider_subscription_id: sub.provider_subscription_id,
    },
  });

  logEvent("dev_console_billing_adjusted", { organization_id: orgId, status });

  return jsonResponse({ ok: true, result }, 200, req);
});
