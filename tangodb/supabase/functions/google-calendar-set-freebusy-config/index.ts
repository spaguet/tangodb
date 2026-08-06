import {
  getClientIp,
  handleOptions,
  jsonResponse,
} from "../_shared/http.ts";
import {
  listGoogleCalendars,
  loadGoogleOAuthConfigOrThrow,
  mapCalendarApiError,
  obtainAccessTokenForAccount,
} from "../_shared/googleCalendarClient.ts";
import {
  accountHasFreebusyScopes,
  resolveFreebusyConsentScopes,
} from "../_shared/googleOAuth.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createServiceClient, createUserClient, logEvent } from "../_shared/supabase.ts";

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 15 * 60_000;

type SetFreebusyBody = {
  organization_member_id?: string;
  freebusy_calendar_ids?: string[];
};

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
  if (!checkRateLimit(`gcal-set-freebusy:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const userClient = createUserClient(authHeader);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return jsonResponse({ error: "Unauthorized" }, 401, req);
  }

  let body: SetFreebusyBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, req);
  }

  const memberId = (body.organization_member_id ?? "").trim();
  const rawIds = Array.isArray(body.freebusy_calendar_ids) ? body.freebusy_calendar_ids : [];
  const calendarIds = [...new Set(rawIds.map((id) => String(id).trim()).filter(Boolean))];

  if (!memberId) {
    return jsonResponse({ error: "organization_member_id required" }, 400, req);
  }

  const userId = userData.user.id;
  const admin = createServiceClient();
  const nowIso = new Date().toISOString();

  const { data: member } = await admin
    .from("organization_members")
    .select("id, organization_id, user_id, is_active")
    .eq("id", memberId)
    .maybeSingle();

  if (!member || member.user_id !== userId) {
    return jsonResponse({ error: "Forbidden" }, 403, req);
  }

  if (!member.is_active) {
    return jsonResponse({ error: "member_not_active" }, 403, req);
  }

  const { data: binding } = await admin
    .from("member_google_calendar_bindings")
    .select("id, google_account_id, calendar_id, enabled")
    .eq("organization_id", member.organization_id)
    .eq("organization_member_id", memberId)
    .eq("enabled", true)
    .maybeSingle();

  if (!binding) {
    return jsonResponse({ error: "binding_not_configured" }, 400, req);
  }

  if (calendarIds.length > 0) {
    const { data: account } = await admin
      .from("user_google_accounts")
      .select("id, granted_scopes, status")
      .eq("id", binding.google_account_id)
      .maybeSingle();

    if (!account || account.status !== "active") {
      return jsonResponse({ error: "token_revoked", code: "token_revoked" }, 401, req);
    }

    if (!accountHasFreebusyScopes(account.granted_scopes as string[] | null, calendarIds)) {
      return jsonResponse({ error: "freebusy_scope_missing", code: "freebusy_scope_missing" }, 403, req);
    }

    try {
      const config = await loadGoogleOAuthConfigOrThrow();
      const accessToken = await obtainAccessTokenForAccount(
        admin,
        config,
        binding.google_account_id as string,
        userId
      );
      const available = await listGoogleCalendars(accessToken, { forFreebusy: true });
      const allowed = new Set(available.filter((c) => c.selectable).map((c) => c.id));
      for (const id of calendarIds) {
        if (!allowed.has(id)) {
          return jsonResponse({ error: "invalid_calendar_id", code: "invalid_calendar_id" }, 400, req);
        }
      }
    } catch (err) {
      const mapped = mapCalendarApiError(err);
      return jsonResponse(mapped.body, mapped.status, req);
    }
  }

  const { error: updateError } = await admin
    .from("member_google_calendar_bindings")
    .update({
      freebusy_calendar_ids: calendarIds,
      updated_at: nowIso,
    })
    .eq("id", binding.id);

  if (updateError) {
    logEvent("gcal_set_freebusy_error", {
      user_id: userId,
      code: updateError.code ?? "update_failed",
    });
    return jsonResponse({ error: "Failed to save freebusy config" }, 500, req);
  }

  logEvent("gcal_set_freebusy_config", {
    user_id: userId,
    organization_member_id: memberId,
    calendar_count: calendarIds.length,
    required_scopes: resolveFreebusyConsentScopes(calendarIds),
  });

  return jsonResponse({
    ok: true,
    freebusy_calendar_ids: calendarIds,
  }, 200, req);
});
