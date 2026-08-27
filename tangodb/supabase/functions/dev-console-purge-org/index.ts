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
  if (!(await checkRateLimit(`dev-console-purge-org:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS))) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const userClient = createUserClient(authHeader);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user || !isDeveloper(userData.user, authHeader)) {
    return jsonResponse({ error: "developer_access_required" }, 403, req);
  }

  let body: {
    organization_id?: string;
    org_name_confirm?: string;
    reason?: string;
    force_licensed?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, req);
  }

  const orgId = (body.organization_id ?? "").trim();
  const nameConfirm = (body.org_name_confirm ?? "").trim();
  const reason = (body.reason ?? "").trim().slice(0, 500);
  const forceLicensed = body.force_licensed === true;

  if (!orgId) {
    return jsonResponse({ error: "organization_id required" }, 400, req);
  }

  const admin = createServiceClient();

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("id, name, status")
    .eq("id", orgId)
    .maybeSingle();

  if (orgError || !org) {
    return jsonResponse({ error: "Organization not found" }, 404, req);
  }

  if (org.status === "purged") {
    return jsonResponse({ error: "Organization already purged" }, 400, req);
  }

  if (nameConfirm !== org.name) {
    return jsonResponse({ error: "org_name_mismatch" }, 400, req);
  }

  const { data: result, error: purgeError } = await admin.rpc("purge_single_organization", {
    p_org_id: orgId,
    p_actor_user_id: userData.user.id,
    p_reason: reason || null,
    p_force_licensed: forceLicensed,
  });

  if (purgeError) {
    const msg = purgeError.message ?? "";
    if (msg.includes("licensed_org_purge_forbidden")) {
      return jsonResponse({ error: "licensed_org_purge_forbidden" }, 403, req);
    }
    if (msg.includes("active_subscription_purge_forbidden")) {
      return jsonResponse({ error: "active_subscription_purge_forbidden" }, 403, req);
    }
    logEvent("dev_console_purge_org_error", { message: msg });
    return jsonResponse({ error: "Purge failed" }, 500, req);
  }

  logEvent("dev_console_purge_org", { org_id: orgId });

  return jsonResponse({ ok: true, ...(result as Record<string, unknown>) }, 200, req);
});
