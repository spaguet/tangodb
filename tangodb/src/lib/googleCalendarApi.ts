import { supabase } from "./supabase";

export type GoogleAccountStatus = "active" | "revoked" | "error";

export interface GoogleAccountSummary {
  id: string;
  google_email: string;
  status: GoogleAccountStatus;
  granted_scopes: string[] | null;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemberGoogleCalendarBinding {
  id: string;
  organization_id: string;
  organization_member_id: string;
  google_account_id: string;
  calendar_id: string;
  calendar_name: string;
  timezone: string;
  enabled: boolean;
  sync_group: boolean;
  sync_personal: boolean;
  sync_events: boolean;
  privacy_mode: string;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error_code: string | null;
  cleanup_pending: boolean;
  disabled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface GoogleCalendarListEntry {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
  timeZone: string;
  selectable: boolean;
}

type EdgePayload = { ok?: boolean; error?: string; code?: string };

async function parseFunctionError(error: unknown): Promise<string> {
  const fnError = error as { message?: string; context?: Response };
  if (fnError.context) {
    try {
      const body = (await fnError.context.json()) as { error?: string; code?: string };
      if (body.code) return body.code;
      if (body.error) return body.error;
    } catch {
      /* ignore parse failure */
    }
  }
  return fnError.message ?? "request_failed";
}

async function invokeFunction<T extends EdgePayload>(
  name: string,
  body?: Record<string, unknown>
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });

  if (error) {
    throw new Error(await parseFunctionError(error));
  }

  const payload = data as T;
  if (!payload?.ok) {
    throw new Error(payload?.error ?? payload?.code ?? "request_failed");
  }
  return payload;
}

export async function fetchMyGoogleAccounts(): Promise<GoogleAccountSummary[]> {
  const { data, error } = await supabase.rpc("list_my_google_accounts");
  if (error) throw new Error(error.message);
  return (data ?? []) as GoogleAccountSummary[];
}

export async function fetchMemberGoogleBinding(
  organizationMemberId: string
): Promise<MemberGoogleCalendarBinding | null> {
  const { data, error } = await supabase
    .from("member_google_calendar_bindings")
    .select(
      "id, organization_id, organization_member_id, google_account_id, calendar_id, calendar_name, timezone, enabled, sync_group, sync_personal, sync_events, privacy_mode, last_success_at, last_error_at, last_error_code, cleanup_pending, disabled_at, created_at, updated_at"
    )
    .eq("organization_member_id", organizationMemberId)
    .eq("enabled", true)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as MemberGoogleCalendarBinding | null) ?? null;
}

export async function startGoogleCalendarOAuth(returnUrl: string): Promise<string> {
  const payload = await invokeFunction<{ ok: boolean; url?: string }>(
    "google-calendar-auth-start",
    { return_url: returnUrl }
  );
  if (!payload.url) throw new Error("missing_oauth_url");
  return payload.url;
}

export async function listGoogleCalendars(googleAccountId: string): Promise<GoogleCalendarListEntry[]> {
  const payload = await invokeFunction<{ ok: boolean; calendars?: GoogleCalendarListEntry[] }>(
    "google-calendar-list-calendars",
    { google_account_id: googleAccountId }
  );
  return payload.calendars ?? [];
}

export async function createGoogleCalendar(
  googleAccountId: string,
  organizationId: string
): Promise<GoogleCalendarListEntry> {
  const payload = await invokeFunction<{ ok: boolean; calendar?: GoogleCalendarListEntry }>(
    "google-calendar-create-calendar",
    { google_account_id: googleAccountId, organization_id: organizationId }
  );
  if (!payload.calendar) throw new Error("missing_calendar");
  return payload.calendar;
}

export async function setGoogleCalendarBinding(input: {
  organizationMemberId: string;
  googleAccountId: string;
  calendarId: string;
  calendarName: string;
  timezone: string;
  deleteOldEvents?: boolean;
}): Promise<void> {
  await invokeFunction("google-calendar-set-binding", {
    organization_member_id: input.organizationMemberId,
    google_account_id: input.googleAccountId,
    calendar_id: input.calendarId,
    calendar_name: input.calendarName,
    timezone: input.timezone,
    delete_old_events: input.deleteOldEvents ?? false,
  });
}

export async function disconnectGoogleCalendar(input: {
  organizationMemberId?: string;
  deleteFutureEvents?: boolean;
  revokeAccount?: boolean;
  googleAccountId?: string;
}): Promise<void> {
  await invokeFunction("google-calendar-disconnect", {
    organization_member_id: input.organizationMemberId,
    delete_future_events: input.deleteFutureEvents ?? false,
    revoke_account: input.revokeAccount ?? false,
    google_account_id: input.googleAccountId,
  });
}
