import { isDeveloper } from "../_shared/devAuth.ts";
import {
  getClientIp,
  handleOptions,
  jsonResponse,
} from "../_shared/http.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import {
  normalizeRecoveryCode,
  verifyRecoveryCode,
} from "../_shared/recoveryCode.ts";
import { sha256Hex } from "../_shared/securePassword.ts";
import { createServiceClient, createUserClient, logEvent } from "../_shared/supabase.ts";

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 15 * 60_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type VerificationBody = {
  recovery_code?: string;
  payment_ref_verified?: boolean;
  lifetime_license_verified?: boolean;
  telegram_binding_verified?: boolean;
  purchase_contact_verified?: boolean;
  org_data_verified?: boolean;
};

const MANUAL_FACTORS = [
  "payment_ref_verified",
  "lifetime_license_verified",
  "telegram_binding_verified",
  "purchase_contact_verified",
  "org_data_verified",
] as const;

function isDemoStatus(status: string): boolean {
  return status === "demo_active" || status === "demo_retention";
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
  if (!(await checkRateLimit(`dev-console-transfer-owner:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS))) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const userClient = createUserClient(authHeader);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user || !isDeveloper(userData.user, authHeader)) {
    return jsonResponse({ error: "developer_access_required" }, 403, req);
  }

  let body: {
    organization_id?: string;
    new_email?: string;
    reason?: string;
    verification?: VerificationBody;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, req);
  }

  const orgId = (body.organization_id ?? "").trim();
  const newEmail = (body.new_email ?? "").trim().toLowerCase();
  const reason = (body.reason ?? "").trim().slice(0, 500);
  const verification = body.verification ?? {};

  if (!orgId) {
    return jsonResponse({ error: "organization_id required" }, 400, req);
  }
  if (!newEmail || !EMAIL_RE.test(newEmail)) {
    return jsonResponse({ error: "valid new_email required" }, 400, req);
  }
  if (!reason) {
    return jsonResponse({ error: "reason required" }, 400, req);
  }

  const admin = createServiceClient();

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("id, owner_user_id, status, payment_ref")
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

  const { data: ownerAuth, error: ownerAuthError } = await admin.auth.admin.getUserById(
    org.owner_user_id
  );
  if (ownerAuthError || !ownerAuth.user) {
    return jsonResponse({ error: "Owner user not found" }, 404, req);
  }

  const oldEmail = (ownerAuth.user.email ?? "").trim().toLowerCase();
  if (oldEmail === newEmail) {
    return jsonResponse({ error: "new_email_same_as_current" }, 400, req);
  }

  const verifiedFactors: string[] = [];

  const recoveryCodeInput = (verification.recovery_code ?? "").trim();
  if (recoveryCodeInput) {
    const { data: codeRow, error: codeError } = await admin
      .from("user_recovery_codes")
      .select("code_hash")
      .eq("user_id", org.owner_user_id)
      .is("revoked_at", null)
      .maybeSingle();

    if (codeError) {
      logEvent("dev_console_transfer_recovery_lookup_error", { code: codeError.code ?? "unknown" });
      return jsonResponse({ error: "Service unavailable" }, 500, req);
    }

    if (!codeRow?.code_hash) {
      return jsonResponse({ error: "no_active_recovery_code" }, 400, req);
    }

    const valid = await verifyRecoveryCode(recoveryCodeInput, codeRow.code_hash);
    if (!valid) {
      return jsonResponse({ error: "invalid_recovery_code" }, 400, req);
    }
    verifiedFactors.push("recovery_code");
  }

  if (verification.payment_ref_verified === true) {
    if (!org.payment_ref) {
      return jsonResponse({ error: "payment_ref_not_available" }, 400, req);
    }
    verifiedFactors.push("payment_ref_verified");
  }

  if (verification.lifetime_license_verified === true) {
    const { data: license } = await admin
      .from("organization_licenses")
      .select("license_type")
      .eq("organization_id", orgId)
      .maybeSingle();

    if (license?.license_type !== "lifetime" && org.status !== "licensed") {
      return jsonResponse({ error: "lifetime_license_not_confirmed" }, 400, req);
    }
    verifiedFactors.push("lifetime_license_verified");
  }

  if (verification.telegram_binding_verified === true) {
    const telegramId = ownerAuth.user.app_metadata?.telegram_id;
    if (telegramId == null || String(telegramId).trim() === "") {
      return jsonResponse({ error: "telegram_not_bound" }, 400, req);
    }
    verifiedFactors.push("telegram_binding_verified");
  }

  if (verification.purchase_contact_verified === true) {
    verifiedFactors.push("purchase_contact_verified");
  }

  if (verification.org_data_verified === true) {
    verifiedFactors.push("org_data_verified");
  }

  if (verifiedFactors.length < 2) {
    return jsonResponse({ error: "insufficient_verification_factors" }, 400, req);
  }

  const { data: newEmailHash, error: hashError } = await admin.rpc("owner_email_hash", {
    p_email: newEmail,
  });
  if (hashError || typeof newEmailHash !== "string") {
    return jsonResponse({ error: "Service unavailable" }, 500, req);
  }

  if (isDemoStatus(org.status)) {
    const { data: retention } = await admin
      .from("demo_owner_retention")
      .select("purged_at")
      .eq("owner_email_hash", newEmailHash)
      .maybeSingle();

    if (retention?.purged_at) {
      return jsonResponse({ error: "anti_abuse_purged_demo_email" }, 400, req);
    }
  }

  const { data: existingUserId, error: lookupError } = await admin.rpc(
    "dev_console_user_id_by_email_exact",
    { p_email: newEmail }
  );

  if (lookupError) {
    logEvent("dev_console_transfer_email_lookup_error", { code: lookupError.code ?? "unknown" });
    return jsonResponse({ error: "Service unavailable" }, 500, req);
  }

  let transferMode: "update_email" | "reassign_user" = "update_email";

  if (existingUserId && existingUserId !== org.owner_user_id) {
    transferMode = "reassign_user";
    const { error: reassignError } = await admin.rpc("dev_console_reassign_org_owner", {
      p_org_id: orgId,
      p_new_user_id: existingUserId,
      p_old_owner_user_id: org.owner_user_id,
    });

    if (reassignError) {
      logEvent("dev_console_reassign_owner_error", { message: reassignError.message });
      return jsonResponse({ error: "Owner transfer failed" }, 500, req);
    }
  } else if (!existingUserId) {
    const { error: updateError } = await admin.auth.admin.updateUserById(org.owner_user_id, {
      email: newEmail,
      email_confirm: true,
    });

    if (updateError) {
      logEvent("dev_console_transfer_email_error", { code: updateError.message });
      if (updateError.message.toLowerCase().includes("already")) {
        return jsonResponse({ error: "new_email_already_registered" }, 409, req);
      }
      return jsonResponse({ error: "Email update failed" }, 500, req);
    }
  }

  const oldEmailHash = oldEmail ? await sha256Hex(oldEmail) : null;
  const newEmailHashHex = await sha256Hex(newEmail);
  const ownerUserIdHash = await sha256Hex(org.owner_user_id);

  await admin.from("platform_audit_log").insert({
    actor_user_id: userData.user.id,
    action: "owner.email_transfer_by_support",
    target_type: "organization",
    target_id: orgId,
    metadata: {
      reason,
      transfer_mode: transferMode,
      old_email_hash: oldEmailHash,
      new_email_hash: newEmailHashHex,
      owner_user_id_hash: ownerUserIdHash,
      verification_factors: verifiedFactors,
      recovery_code_provided: recoveryCodeInput.length > 0,
      recovery_code_normalized_length: recoveryCodeInput
        ? normalizeRecoveryCode(recoveryCodeInput).length
        : 0,
    },
  });

  logEvent("dev_console_owner_email_transfer", {
    org_id: orgId,
    transfer_mode: transferMode,
    factor_count: verifiedFactors.length,
  });

  return jsonResponse(
    {
      ok: true,
      organization_id: orgId,
      transfer_mode: transferMode,
      message: "Owner email updated — old owner access revoked on reassign; deliver new login instructions once",
    },
    200,
    req
  );
});
