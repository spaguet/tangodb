import { hashInviteToken } from "../_shared/inviteToken.ts";
import {
  getClientIp,
  handleOptions,
  jsonResponse,
} from "../_shared/http.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createServiceClient, logEvent } from "../_shared/supabase.ts";

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 15 * 60_000;

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
  if (!checkRateLimit(`preview-invite:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, req);
  }

  const plaintextToken = (body.token ?? "").trim();
  if (!plaintextToken) {
    return jsonResponse({ error: "Invalid invite" }, 400, req);
  }

  const tokenHash = await hashInviteToken(plaintextToken, pepper);
  const admin = createServiceClient();

  const { data: invite, error } = await admin
    .from("organization_invites")
    .select("email, expires_at, organizations(name)")
    .eq("token_hash", tokenHash)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error || !invite) {
    return jsonResponse({ error: "Invalid or expired invite" }, 400, req);
  }

  const orgName =
    (invite.organizations as { name?: string } | null)?.name ?? null;

  return jsonResponse(
    {
      ok: true,
      email: invite.email as string,
      organization_name: orgName,
      expires_at: invite.expires_at as string,
    },
    200,
    req
  );
});
