import { hashAccessKey } from "../_shared/accessKey.ts";
import {
  getClientIp,
  handleOptions,
  jsonResponse,
} from "../_shared/http.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createServiceClient, createUserClient, logEvent } from "../_shared/supabase.ts";

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 15 * 60_000;
const ACTIVATION_DEBUG = (Deno.env.get("ACTIVATION_DEBUG") ?? "false") === "true";

type ActivationAuditMetadata = Record<string, string | number | boolean | null>;

async function auditActivation(
  admin: ReturnType<typeof createServiceClient>,
  action: string,
  actorUserId: string | null,
  metadata: ActivationAuditMetadata,
  targetId?: string | null
): Promise<void> {
  const { error } = await admin.from("platform_audit_log").insert({
    actor_user_id: actorUserId,
    action,
    target_type: "activation",
    target_id: targetId ?? null,
    metadata,
  });
  if (error) {
    logEvent("activation_audit_error", { code: error.code ?? "unknown", action });
  }
}

function debugMessage(message: string, code: string | null): string | undefined {
  if (!ACTIVATION_DEBUG) return undefined;
  return code ? `${code}: ${message}` : message;
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

  const pepper = Deno.env.get("ACCESS_KEY_PEPPER");
  if (!pepper) {
    return jsonResponse({ error: "Service unavailable" }, 500, req);
  }

  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`activate-key:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS))) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  let body: { key?: string; org_name?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, req);
  }

  const plaintextKey = (body.key ?? "").trim();
  if (!plaintextKey) {
    return jsonResponse({ error: "Invalid access key" }, 400, req);
  }

  const supabase = createUserClient(authHeader);
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return jsonResponse({ error: "Unauthorized" }, 401, req);
  }

  const email = userData.user.email ?? "";
  if (!(await checkRateLimit(`activate-key:email:${email || clientIp}`, RATE_LIMIT, RATE_WINDOW_MS))) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const keyHash = await hashAccessKey(plaintextKey.replace(/\s+/g, ""), pepper);
  const orgName = body.org_name?.trim() || null;

  const admin = createServiceClient();
  const { data, error } = await admin.rpc("activate_access_key", {
    p_key_hash: keyHash,
    p_org_name: orgName,
    p_user_id: userData.user.id,
  });

  if (error) {
    const message = error.message ?? "Activation failed";
    const code = error.code ?? "unknown";
    const auditBase = {
      code,
      email_domain: email.includes("@") ? email.split("@")[1] : null,
      client_ip: clientIp,
      ...(ACTIVATION_DEBUG ? { message } : {}),
    };
    logEvent("activate_key_error", { code, ...(ACTIVATION_DEBUG ? { message } : {}) });
    await auditActivation(admin, "activation.error", userData.user.id, auditBase);
    if (
      message.includes("invalid access key") ||
      message.includes("different CRM version") ||
      message.includes("crm version not configured") ||
      message.includes("email required")
    ) {
      logEvent("activate_key_rejected", { reason: "validation" });
      await auditActivation(admin, "activation.rejected", userData.user.id, {
        ...auditBase,
        reason: "validation",
      });
      const debug = debugMessage(message, code);
      return jsonResponse(
        debug ? { error: "Invalid access key", debug } : { error: "Invalid access key" },
        400,
        req
      );
    }
    if (message.includes("not authenticated")) {
      const debug = debugMessage(message, code);
      return jsonResponse(
        debug ? { error: "Session expired", debug } : { error: "Session expired" },
        401,
        req
      );
    }
    const debug = debugMessage(message, code);
    return jsonResponse(
      debug ? { error: "Activation failed", debug } : { error: "Activation failed" },
      500,
      req
    );
  }

  logEvent("activate_key_success", {
    key_type: typeof data?.key_type === "string" ? data.key_type : "unknown",
    upgraded: Boolean(data?.upgraded),
  });
  await auditActivation(
    admin,
    "activation.success",
    userData.user.id,
    {
      key_type: typeof data?.key_type === "string" ? data.key_type : "unknown",
      status: typeof data?.status === "string" ? data.status : null,
      upgraded: Boolean(data?.upgraded),
      email_domain: email.includes("@") ? email.split("@")[1] : null,
      client_ip: clientIp,
    },
    typeof data?.organization_id === "string" ? data.organization_id : null
  );

  return jsonResponse({ ok: true, ...(data as Record<string, unknown>) }, 200, req);
});
