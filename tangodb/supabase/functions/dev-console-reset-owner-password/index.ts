import { isDeveloper } from "../_shared/devAuth.ts";
import { generateSecurePassword, sha256Hex } from "../_shared/securePassword.ts";
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
  if (!(await checkRateLimit(`dev-console-reset-pwd:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS))) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const userClient = createUserClient(authHeader);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user || !isDeveloper(userData.user, authHeader)) {
    return jsonResponse({ error: "developer_access_required" }, 403, req);
  }

  let body: { organization_id?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, req);
  }

  const orgId = (body.organization_id ?? "").trim();
  if (!orgId) {
    return jsonResponse({ error: "organization_id required" }, 400, req);
  }

  const admin = createServiceClient();

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("id, owner_user_id, status")
    .eq("id", orgId)
    .maybeSingle();

  if (orgError || !org) {
    return jsonResponse({ error: "Organization not found" }, 404, req);
  }

  if (!org.owner_user_id) {
    return jsonResponse({ error: "Organization has no owner" }, 400, req);
  }

  if (org.status === "purged") {
    return jsonResponse({ error: "Organization is purged" }, 400, req);
  }

  const newPassword = generateSecurePassword(16);

  const { error: updateError } = await admin.auth.admin.updateUserById(org.owner_user_id, {
    password: newPassword,
  });

  if (updateError) {
    logEvent("dev_console_reset_pwd_error", { code: updateError.message });
    return jsonResponse({ error: "Password reset failed" }, 500, req);
  }

  const ownerHash = await sha256Hex(org.owner_user_id);

  await admin.from("platform_audit_log").insert({
    actor_user_id: userData.user.id,
    action: "owner.password_reset_by_support",
    target_type: "organization",
    target_id: orgId,
    metadata: {
      owner_user_id_hash: ownerHash,
    },
  });

  logEvent("dev_console_owner_password_reset", { org_id: orgId });

  return jsonResponse(
    {
      ok: true,
      organization_id: orgId,
      temporary_password: newPassword,
      message: "Deliver password to owner once — not stored in audit log",
    },
    200,
    req
  );
});
