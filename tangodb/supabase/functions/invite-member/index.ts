import { sendTransactionalEmail } from "../_shared/email.ts";
import { hashInviteToken, generateInviteToken } from "../_shared/inviteToken.ts";
import {
  getClientIp,
  handleOptions,
  isValidEmail,
  jsonResponse,
  normalizeEmail,
} from "../_shared/http.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createUserClient, logEvent } from "../_shared/supabase.ts";

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 15 * 60_000;

const ASSIGNABLE_ROLES = new Set(["admin", "teacher", "accountant"]);

async function sendInviteEmail(
  email: string,
  inviteUrl: string,
  orgName: string
): Promise<boolean> {
  const subject = `TangoDB — приглашение в ${orgName}`;
  const text =
    `Здравствуйте!\n\n` +
    `Вас пригласили в организацию «${orgName}» в TangoDB CRM.\n\n` +
    `Примите приглашение: ${inviteUrl}\n\n` +
    `Ссылка действует 7 дней.\n`;

  return sendTransactionalEmail({ to: email, subject, text });
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

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Unauthorized" }, 401, req);
  }

  const clientIp = getClientIp(req);
  if (!checkRateLimit(`invite-member:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  let body: { email?: string; role?: string; scope?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, req);
  }

  const email = normalizeEmail(body.email ?? "");
  const role = (body.role ?? "").trim();

  if (!isValidEmail(email)) {
    return jsonResponse({ error: "Invalid email" }, 400, req);
  }
  if (!ASSIGNABLE_ROLES.has(role)) {
    return jsonResponse({ error: "Invalid role" }, 400, req);
  }

  const supabase = createUserClient(authHeader);
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return jsonResponse({ error: "Unauthorized" }, 401, req);
  }

  const plaintextToken = generateInviteToken();
  const tokenHash = await hashInviteToken(plaintextToken, pepper);

  const { data, error } = await supabase.rpc("create_organization_invite", {
    p_email: email,
    p_role: role,
    p_scope: body.scope ?? null,
    p_token_hash: tokenHash,
  });

  if (error) {
    const msg = error.message ?? "Invite failed";
    if (msg.includes("permission denied") || msg.includes("cannot assign")) {
      return jsonResponse({ error: "Permission denied" }, 403, req);
    }
    if (msg.includes("already")) {
      return jsonResponse({ error: msg }, 409, req);
    }
    logEvent("invite_member_error", { code: error.code ?? "unknown" });
    return jsonResponse({ error: "Invite failed" }, 400, req);
  }

  const siteUrl = Deno.env.get("SITE_URL") ?? "https://tangodb.vercel.app";
  const inviteUrl = `${siteUrl}/accept-invite?token=${encodeURIComponent(plaintextToken)}`;

  const { data: orgRow } = await supabase
    .from("organizations")
    .select("name")
    .maybeSingle();

  const orgName = (orgRow?.name as string | undefined) ?? "организацию";
  const emailSent = await sendInviteEmail(email, inviteUrl, orgName);

  logEvent("invite_created", { role, email_domain: email.split("@")[1] ?? "unknown" });

  return jsonResponse(
    {
      ok: true,
      invite_id: data?.invite_id,
      invite_url: inviteUrl,
      email_sent: emailSent,
      expires_at: data?.expires_at,
    },
    200,
    req
  );
});
