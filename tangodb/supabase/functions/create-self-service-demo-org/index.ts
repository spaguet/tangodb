import {
  generateRecoveryCode,
  hashRecoveryCode,
} from "../_shared/recoveryCode.ts";
import {
  getClientIp,
  handleOptions,
  jsonResponse,
} from "../_shared/http.ts";
import { ownerEmailHash } from "../_shared/emailHash.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createServiceClient, createUserClient, logEvent } from "../_shared/supabase.ts";
import { isDeveloper } from "../_shared/devAuth.ts";

const RATE_LIMIT = 5;
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
  if (!checkRateLimit(`create-self-service-demo:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const supabase = createUserClient(authHeader);
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return jsonResponse({ error: "Unauthorized" }, 401, req);
  }

  const user = userData.user;
  const email = user.email ?? "";
  if (!email) {
    return jsonResponse({ error: "Email required" }, 400, req);
  }

  if (!user.email_confirmed_at) {
    return jsonResponse({ error: "Email not confirmed" }, 400, req);
  }

  if (!checkRateLimit(`create-self-service-demo:user:${user.id}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const displayName =
    typeof user.user_metadata?.display_name === "string"
      ? user.user_metadata.display_name.trim()
      : "";

  const admin = createServiceClient();

  const { data: existingMembers, error: membersError } = await admin
    .from("organization_members")
    .select("id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .limit(1);

  if (membersError) {
    logEvent("self_service_members_check_error", { code: membersError.code ?? "unknown" });
    return jsonResponse({ error: "Service unavailable" }, 500, req);
  }

  if (existingMembers && existingMembers.length > 0) {
    return jsonResponse(
      {
        ok: true,
        already_has_org: true,
        organization_id: null,
      },
      200,
      req
    );
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

  let recoveryCode: string | null = null;
  let recoveryCodeHash: string | null = null;
  try {
    recoveryCode = generateRecoveryCode();
    recoveryCodeHash = await hashRecoveryCode(recoveryCode);
  } catch (err) {
    logEvent("self_service_recovery_code_error", {
      message: err instanceof Error ? err.message : "unknown",
    });
  }

  const { data, error } = await admin.rpc("create_self_service_demo_org", {
    p_user_id: user.id,
    p_display_name: displayName || null,
    p_email_hash: emailHash,
    p_recovery_code_hash: recoveryCodeHash,
  });

  if (error) {
    const message = error.message ?? "Creation failed";
    logEvent("self_service_demo_error", { code: error.code ?? "unknown", message });

    if (message.includes("turnstile challenge")) {
      return jsonResponse(
        { error: "Complete registration captcha on the sign-up page first" },
        400,
        req
      );
    }
    if (message.includes("demo already used")) {
      return jsonResponse({ error: "Demo already used for this email" }, 409, req);
    }
    if (message.includes("email not confirmed")) {
      return jsonResponse({ error: "Email not confirmed" }, 400, req);
    }
    if (message.includes("already has organization")) {
      return jsonResponse({ ok: true, already_has_org: true }, 200, req);
    }

    return jsonResponse({ error: "Could not create demo organization" }, 500, req);
  }

  if (recoveryCodeHash) {
    await admin
      .from("user_recovery_codes")
      .update({ shown_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("code_hash", recoveryCodeHash)
      .is("revoked_at", null);
  }

  const { error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) {
    logEvent("self_service_refresh_error", { message: refreshError.message });
  }

  logEvent("self_service_demo_created", {
    email_domain: email.includes("@") ? email.split("@")[1] : null,
    platform_developer: isDeveloper(user, authHeader),
  });

  return jsonResponse(
    {
      ok: true,
      ...(data as Record<string, unknown>),
      ...(recoveryCode ? { recovery_code: recoveryCode } : {}),
    },
    200,
    req
  );
});
