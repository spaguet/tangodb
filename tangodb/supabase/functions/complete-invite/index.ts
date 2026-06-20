import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { findAuthUserByEmail } from "../_shared/authUsers.ts";
import { hashInviteToken } from "../_shared/inviteToken.ts";
import {
  getClientIp,
  handleOptions,
  jsonResponse,
} from "../_shared/http.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createServiceClient, logEvent } from "../_shared/supabase.ts";

const RATE_LIMIT = 10;
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
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!pepper || !supabaseUrl || !anonKey) {
    return jsonResponse({ error: "Service unavailable" }, 500, req);
  }

  const clientIp = getClientIp(req);
  if (!checkRateLimit(`complete-invite:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  let body: { token?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, req);
  }

  const plaintextToken = (body.token ?? "").trim();
  const password = body.password ?? "";

  if (!plaintextToken) {
    return jsonResponse({ error: "Invalid invite" }, 400, req);
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return jsonResponse({ error: "Password must be at least 8 characters" }, 400, req);
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

  let user = await findAuthUserByEmail(email);
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user) {
      logEvent("complete_invite_create_user_error", {
        message: error?.message ?? "unknown",
      });
      return jsonResponse({ error: "Failed to create account" }, 400, req);
    }
    user = data.user;
  } else {
    const { error } = await admin.auth.admin.updateUserById(user.id, { password });
    if (error) {
      logEvent("complete_invite_password_error", { message: error.message });
      return jsonResponse({ error: "Failed to set password" }, 400, req);
    }
  }

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

  const anonClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: signInData, error: signInError } = await anonClient.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError || !signInData.session) {
    logEvent("complete_invite_signin_error", {
      message: signInError?.message ?? "no_session",
    });
    return jsonResponse({ error: "Account created but sign-in failed" }, 500, req);
  }

  logEvent("invite_completed", { organization_id: orgId ?? null });

  return jsonResponse(
    {
      ok: true,
      access_token: signInData.session.access_token,
      refresh_token: signInData.session.refresh_token,
      organization_id: orgId,
      role: acceptData?.role,
    },
    200,
    req
  );
});
