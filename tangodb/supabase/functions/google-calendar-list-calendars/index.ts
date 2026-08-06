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
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createServiceClient, createUserClient, logEvent } from "../_shared/supabase.ts";

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 15 * 60_000;

type ListBody = {
  google_account_id?: string;
  purpose?: string;
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
  if (!checkRateLimit(`gcal-list-calendars:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const userClient = createUserClient(authHeader);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return jsonResponse({ error: "Unauthorized" }, 401, req);
  }

  let body: ListBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, req);
  }

  const googleAccountId = (body.google_account_id ?? "").trim();
  if (!googleAccountId) {
    return jsonResponse({ error: "google_account_id required" }, 400, req);
  }

  const userId = userData.user.id;
  const admin = createServiceClient();

  try {
    const config = await loadGoogleOAuthConfigOrThrow();
    const forFreebusy = (body.purpose ?? "").trim() === "freebusy";
    const accessToken = await obtainAccessTokenForAccount(admin, config, googleAccountId, userId);
    const calendars = await listGoogleCalendars(accessToken, { forFreebusy });

    logEvent("gcal_list_calendars", {
      user_id: userId,
      google_account_id: googleAccountId,
      count: calendars.length,
    });

    return jsonResponse({ ok: true, calendars }, 200, req);
  } catch (err) {
    const mapped = mapCalendarApiError(err);
    logEvent("gcal_list_calendars_error", {
      user_id: userId,
      google_account_id: googleAccountId,
      code: String(mapped.body.code ?? mapped.body.error ?? "unknown"),
    });
    return jsonResponse(mapped.body, mapped.status, req);
  }
});
