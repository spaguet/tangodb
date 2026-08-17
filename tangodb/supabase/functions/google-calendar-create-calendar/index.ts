import {
  getClientIp,
  handleOptions,
  jsonResponse,
} from "../_shared/http.ts";
import {
  createGoogleCalendar,
  listGoogleCalendars,
  loadGoogleOAuthConfigOrThrow,
  obtainAccessTokenForAccount,
  mapCalendarApiError,
} from "../_shared/googleCalendarClient.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createServiceClient, createUserClient, logEvent } from "../_shared/supabase.ts";

const RATE_LIMIT = 15;
const RATE_WINDOW_MS = 15 * 60_000;
const DEFAULT_TIMEZONE = "Europe/Moscow";

type CreateBody = {
  google_account_id?: string;
  organization_id?: string;
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
  if (!checkRateLimit(`gcal-create-calendar:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const userClient = createUserClient(authHeader);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return jsonResponse({ error: "Unauthorized" }, 401, req);
  }

  let body: CreateBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, req);
  }

  const googleAccountId = (body.google_account_id ?? "").trim();
  const organizationId = (body.organization_id ?? "").trim();

  if (!googleAccountId) {
    return jsonResponse({ error: "google_account_id required" }, 400, req);
  }
  if (!organizationId) {
    return jsonResponse({ error: "organization_id required" }, 400, req);
  }

  const userId = userData.user.id;
  const admin = createServiceClient();

  const { data: member } = await admin
    .from("organization_members")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (!member) {
    return jsonResponse({ error: "Forbidden" }, 403, req);
  }

  const { data: org } = await admin
    .from("organizations")
    .select("name")
    .eq("id", organizationId)
    .maybeSingle();

  const orgName = (org?.name as string | undefined)?.trim() || "School";

  const { data: settings } = await admin
    .from("organization_settings")
    .select("timezone")
    .eq("organization_id", organizationId)
    .maybeSingle();

  const timeZone =
    (settings?.timezone as string | undefined)?.trim() || DEFAULT_TIMEZONE;
  const summary = `TangoDB / ${orgName}`;

  try {
    const config = await loadGoogleOAuthConfigOrThrow();
    const accessToken = await obtainAccessTokenForAccount(admin, config, googleAccountId, userId);

    const existingCalendars = await listGoogleCalendars(accessToken);
    const existing = existingCalendars.find(
      (cal) => cal.summary.trim() === summary && cal.selectable
    );
    if (existing) {
      logEvent("gcal_create_calendar_reuse", {
        user_id: userId,
        google_account_id: googleAccountId,
        organization_id: organizationId,
        calendar_id: existing.id,
      });

      return jsonResponse({
        ok: true,
        reused: true,
        calendar: {
          id: existing.id,
          summary: existing.summary,
          timeZone: existing.timeZone,
          accessRole: existing.accessRole,
          selectable: existing.selectable,
          primary: existing.primary,
        },
      }, 200, req);
    }

    const calendar = await createGoogleCalendar(accessToken, summary, timeZone);

    logEvent("gcal_create_calendar", {
      user_id: userId,
      google_account_id: googleAccountId,
      organization_id: organizationId,
      calendar_id: calendar.id,
    });

    return jsonResponse({
      ok: true,
      calendar: {
        id: calendar.id,
        summary: calendar.summary,
        timeZone: calendar.timeZone,
        accessRole: "owner",
        selectable: true,
        primary: false,
      },
    }, 200, req);
  } catch (err) {
    const mapped = mapCalendarApiError(err);
    logEvent("gcal_create_calendar_error", {
      user_id: userId,
      google_account_id: googleAccountId,
      organization_id: organizationId,
      code: String(mapped.body.code ?? mapped.body.error ?? "unknown"),
    });
    return jsonResponse(mapped.body, mapped.status, req);
  }
});
