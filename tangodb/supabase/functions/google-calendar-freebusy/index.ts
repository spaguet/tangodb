import {
  getClientIp,
  handleOptions,
  jsonResponse,
} from "../_shared/http.ts";
import {
  loadGoogleOAuthConfigOrThrow,
  mapCalendarApiError,
  obtainAccessTokenForGoogleAccount,
  queryCalendarFreebusy,
} from "../_shared/googleCalendarClient.ts";
import { accountHasFreebusyScopes } from "../_shared/googleOAuth.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createServiceClient, createUserClient, logEvent } from "../_shared/supabase.ts";

const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 15 * 60_000;

type FreebusyBody = {
  organization_member_id?: string;
  date?: string;
  time_start?: string;
  time_end?: string;
};

function toGoogleDateTime(date: string, time: string): string {
  const hm = time.length >= 5 ? time.slice(0, 5) : time;
  return `${date}T${hm}:00`;
}

function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidTime(value: string): boolean {
  return /^\d{2}:\d{2}$/.test(value.slice(0, 5));
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
  if (!(await checkRateLimit(`gcal-freebusy:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS))) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const userClient = createUserClient(authHeader);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return jsonResponse({ error: "Unauthorized" }, 401, req);
  }

  let body: FreebusyBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, req);
  }

  const teacherMemberId = (body.organization_member_id ?? "").trim();
  const date = (body.date ?? "").trim();
  const timeStart = (body.time_start ?? "").trim();
  const timeEnd = (body.time_end ?? "").trim();

  if (!teacherMemberId) {
    return jsonResponse({ error: "organization_member_id required" }, 400, req);
  }
  if (!isValidDate(date) || !isValidTime(timeStart) || !isValidTime(timeEnd)) {
    return jsonResponse({ error: "invalid_datetime" }, 400, req);
  }
  if (timeEnd <= timeStart) {
    return jsonResponse({ error: "invalid_time_range" }, 400, req);
  }

  const admin = createServiceClient();
  const callerId = userData.user.id;

  const { data: teacherMember } = await admin
    .from("organization_members")
    .select("id, organization_id, is_active")
    .eq("id", teacherMemberId)
    .maybeSingle();

  if (!teacherMember || !teacherMember.is_active) {
    return jsonResponse({ error: "teacher_not_found" }, 404, req);
  }

  const { data: callerMember } = await admin
    .from("organization_members")
    .select("id, is_active")
    .eq("organization_id", teacherMember.organization_id)
    .eq("user_id", callerId)
    .eq("is_active", true)
    .maybeSingle();

  if (!callerMember) {
    return jsonResponse({ error: "Forbidden" }, 403, req);
  }

  const { data: binding } = await admin
    .from("member_google_calendar_bindings")
    .select("id, google_account_id, freebusy_calendar_ids, enabled")
    .eq("organization_id", teacherMember.organization_id)
    .eq("organization_member_id", teacherMemberId)
    .eq("enabled", true)
    .maybeSingle();

  const calendarIds = (binding?.freebusy_calendar_ids as string[] | null) ?? [];
  if (!binding || calendarIds.length === 0) {
    return jsonResponse({ ok: true, busy: [], configured: false }, 200, req);
  }

  const { data: account } = await admin
    .from("user_google_accounts")
    .select("id, granted_scopes, status")
    .eq("id", binding.google_account_id)
    .maybeSingle();

  if (!account || account.status !== "active") {
    return jsonResponse({ ok: true, busy: [], configured: false }, 200, req);
  }

  if (!accountHasFreebusyScopes(account.granted_scopes as string[] | null, calendarIds)) {
    return jsonResponse({ error: "freebusy_scope_missing", code: "freebusy_scope_missing" }, 403, req);
  }

  const { data: orgSettings } = await admin
    .from("organization_settings")
    .select("timezone")
    .eq("organization_id", teacherMember.organization_id)
    .maybeSingle();

  const timeZone = String(orgSettings?.timezone ?? "UTC");

  try {
    const config = await loadGoogleOAuthConfigOrThrow();
    const accessToken = await obtainAccessTokenForGoogleAccount(
      admin,
      config,
      binding.google_account_id as string
    );

    const busy = await queryCalendarFreebusy(accessToken, {
      calendarIds,
      timeMin: toGoogleDateTime(date, timeStart),
      timeMax: toGoogleDateTime(date, timeEnd),
      timeZone,
    });

    logEvent("gcal_freebusy_query", {
      caller_user_id: callerId,
      teacher_member_id: teacherMemberId,
      calendar_count: calendarIds.length,
      busy_count: busy.length,
    });

    return jsonResponse({ ok: true, busy, configured: true }, 200, req);
  } catch (err) {
    const mapped = mapCalendarApiError(err);
    logEvent("gcal_freebusy_error", {
      caller_user_id: callerId,
      teacher_member_id: teacherMemberId,
      code: String(mapped.body.code ?? mapped.body.error ?? "unknown"),
    });
    return jsonResponse(mapped.body, mapped.status, req);
  }
});
