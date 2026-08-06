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

export interface CalendarSyncMetrics {
  pending_count: number;
  retry_count: number;
  processing_count: number;
  dead_count: number;
  oldest_pending_at: string | null;
}

export async function requestMemberCalendarReconcile(
  organizationMemberId: string
): Promise<void> {
  const { data, error } = await supabase.rpc("request_member_calendar_reconcile", {
    p_organization_member_id: organizationMemberId,
  });
  if (error) throw new Error(error.message);
  const payload = data as { ok?: boolean } | null;
  if (payload && payload.ok !== true) {
    throw new Error("reconcile_request_failed");
  }
}

export async function retryCalendarSyncDeadJob(jobId: string): Promise<void> {
  const { data, error } = await supabase.rpc("retry_calendar_sync_dead_job", {
    p_job_id: jobId,
  });
  if (error) throw new Error(error.message);
  const payload = data as { ok?: boolean } | null;
  if (payload && payload.ok !== true) {
    throw new Error("retry_failed");
  }
}

export async function fetchOrganizationCalendarSyncMetrics(): Promise<CalendarSyncMetrics | null> {
  const { data, error } = await supabase.rpc("get_organization_calendar_sync_metrics");
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return row as CalendarSyncMetrics;
}

export type LessonGoogleSyncUiStatus =
  | "synced"
  | "pending"
  | "error"
  | "not_connected";

export interface PersonalLessonGoogleSyncStatus {
  sync_status: string | null;
  last_synced_at: string | null;
  last_error: string | null;
  has_pending_job: boolean;
  teacher_has_binding: boolean;
}

export function resolveLessonGoogleSyncUiStatus(
  row: PersonalLessonGoogleSyncStatus | null | undefined
): LessonGoogleSyncUiStatus | null {
  if (!row) return null;
  if (!row.teacher_has_binding) return "not_connected";
  if (row.has_pending_job || row.sync_status === "pending") return "pending";
  if (row.sync_status === "failed" || Boolean(row.last_error)) return "error";
  if (row.sync_status === "synced") return "synced";
  return "pending";
}

export async function fetchPersonalLessonGoogleSyncStatus(
  lessonId: string
): Promise<PersonalLessonGoogleSyncStatus | null> {
  const { data, error } = await supabase.rpc("get_personal_lesson_google_sync_status", {
    p_lesson_id: lessonId,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return row as PersonalLessonGoogleSyncStatus;
}

export interface TeamCalendarSyncMemberMetrics {
  organization_member_id: string;
  member_name: string;
  has_active_binding: boolean;
  binding_last_success_at: string | null;
  binding_last_error_code: string | null;
  pending_jobs_count: number;
  dead_jobs_count: number;
  failed_links_count: number;
}

export async function fetchTeamCalendarSyncMetrics(): Promise<TeamCalendarSyncMemberMetrics[]> {
  const { data, error } = await supabase.rpc("get_team_calendar_sync_metrics");
  if (error) throw new Error(error.message);
  return (data ?? []) as TeamCalendarSyncMemberMetrics[];
}

export async function remindGoogleCalendarConnect(
  organizationMemberId: string
): Promise<void> {
  await invokeFunction("google-calendar-remind-connect", {
    organization_member_id: organizationMemberId,
  });
}
