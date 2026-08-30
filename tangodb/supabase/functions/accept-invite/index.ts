import { hashInviteToken, isInviteTokenFormat } from "../_shared/inviteToken.ts";
import {
  getClientIp,
  handleOptions,
  jsonResponse,
} from "../_shared/http.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { isRenterActor, renterActorForbidden } from "../_shared/staffAuth.ts";
import { createUserClient, logEvent } from "../_shared/supabase.ts";

const RATE_LIMIT = 10;
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

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Unauthorized" }, 401, req);
  }

  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`accept-invite:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS))) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, req);
  }

  const plaintextToken = (body.token ?? "").trim();
  if (!plaintextToken || !isInviteTokenFormat(plaintextToken)) {
    return jsonResponse({ error: "Invalid invite" }, 400, req);
  }

  const supabase = createUserClient(authHeader);
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return jsonResponse({ error: "Unauthorized" }, 401, req);
  }
  if (isRenterActor(userData.user)) {
    return renterActorForbidden(req);
  }

  const tokenHash = await hashInviteToken(plaintextToken, pepper);

  const { data, error } = await supabase.rpc("accept_organization_invite", {
    p_token_hash: tokenHash,
  });

  if (error) {
    const msg = error.message ?? "Accept failed";
    if (
      msg.includes("invalid") ||
      msg.includes("expired") ||
      msg.includes("mismatch")
    ) {
      return jsonResponse({ error: "Invalid or expired invite" }, 400, req);
    }
    if (msg.includes("already a member")) {
      return jsonResponse({ ok: true, already_member: true, ...data }, 200, req);
    }
    logEvent("accept_invite_error", { code: error.code ?? "unknown" });
    return jsonResponse({ error: "Accept failed" }, 400, req);
  }

  const orgId = data?.organization_id as string | undefined;
  if (orgId) {
    await supabase.rpc("set_active_organization", { p_organization_id: orgId });
  }

  logEvent("invite_accepted", { organization_id: orgId ?? null });

  return jsonResponse({ ok: true, ...data }, 200, req);
});
