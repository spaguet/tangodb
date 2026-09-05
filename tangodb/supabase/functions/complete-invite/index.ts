import { findAuthUserByEmail } from "../_shared/authUsers.ts";
import { hashInviteToken, normalizeInviteToken } from "../_shared/inviteToken.ts";
import {
  getClientIp,
  handleOptions,
  jsonResponse,
} from "../_shared/http.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createServiceClient, logEvent } from "../_shared/supabase.ts";

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 15 * 60_000;
const MIN_PASSWORD_LENGTH = 8;

async function setActiveOrganization(
  admin: ReturnType<typeof createServiceClient>,
  userId: string,
  organizationId: string,
  memberId: string
): Promise<void> {
  const { error } = await admin.from("user_active_organizations").upsert(
    {
      user_id: userId,
      organization_id: organizationId,
      member_id: memberId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (error) throw error;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, req);
  }

  const pepper = Deno.env.get("ACCESS_KEY_PEPPER");
  if (!pepper) {
    return jsonResponse({ error: "Service unavailable" }, 500, req);
  }

  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`complete-invite:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS))) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  let body: { token?: string; password?: string; email?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, req);
  }

  const plaintextToken = normalizeInviteToken(body.token ?? "");
  if (!plaintextToken) {
    return jsonResponse({ error: "Invalid invite" }, 400, req);
  }

  const tokenHash = await hashInviteToken(plaintextToken, pepper);
  const admin = createServiceClient();

  const { data: invite, error: inviteError } = await admin
    .from("organization_invites")
    .select("email")
    .eq("token_hash", tokenHash)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (inviteError || !invite) {
    return jsonResponse({ error: "Invalid or expired invite" }, 400, req);
  }

  const email = (invite.email as string).trim().toLowerCase();
  let existingUser = null;
  try {
    existingUser = await findAuthUserByEmail(email);
  } catch (err) {
    logEvent("complete_invite_account_lookup_error", {
      message: err instanceof Error ? err.message : "unknown",
    });
  }

  if (existingUser) {
    logEvent("invite_needs_login", { organization_id: null });
    return jsonResponse({ ok: true, needs_login: true }, 200, req);
  }

  const password = body.password ?? "";
  const providedEmail = (body.email ?? "").trim().toLowerCase();
  if (!providedEmail || providedEmail !== email) {
    return jsonResponse({ error: "Invalid invite" }, 400, req);
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return jsonResponse({ error: "Password must be at least 8 characters" }, 400, req);
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    const createMsg = (error?.message ?? "").toLowerCase();
    if (createMsg.includes("already") || createMsg.includes("registered")) {
      return jsonResponse({ ok: true, needs_login: true }, 200, req);
    }
    logEvent("complete_invite_create_user_error", {
      message: error?.message ?? "unknown",
    });
    return jsonResponse({ error: "Failed to create account" }, 400, req);
  }
  const user = data.user;

  const { data: acceptData, error: acceptError } = await admin.rpc(
    "complete_organization_invite_for_user",
    { p_token_hash: tokenHash, p_user_id: user.id }
  );

  if (acceptError) {
    const msg = acceptError.message ?? "Accept failed";
    if (
      msg.includes("invalid") ||
      msg.includes("expired") ||
      msg.includes("mismatch")
    ) {
      return jsonResponse({ error: "Invalid or expired invite" }, 400, req);
    }
    logEvent("complete_invite_accept_error", { message: msg });
    return jsonResponse({ error: "Failed to accept invite" }, 400, req);
  }

  const orgId = acceptData?.organization_id as string | undefined;
  const memberId = acceptData?.member_id as string | undefined;
  if (orgId && memberId) {
    await setActiveOrganization(admin, user.id, orgId, memberId);
  }

  logEvent("invite_completed", { organization_id: orgId ?? null });

  return jsonResponse({ ok: true, account_created: true }, 200, req);
});
