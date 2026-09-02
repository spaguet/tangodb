import { supabase } from "./supabase";

export type GoogleAccountStatus = "active" | "revoked" | "error";

export interface GoogleAccountSummary {
  id: string;
  google_email: string;
  status: GoogleAccountStatus;
  granted_scopes: string[] | null;
  last_verified_at: string | null;
  refresh_token_issued_at?: string | null;
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
  freebusy_calendar_ids?: string[];
  created_at: string;
  updated_at: string;
}

export type GoogleFreebusyInterval = {
  start: string;
  end: string;
};

export interface OrganizationGoogleCalendarBinding {
  id: string;
  organization_id: string;
  google_account_id: string;
  configured_by_member_id: string;
  calendar_id: string;
  calendar_name: string;
  timezone: string;
  enabled: boolean;
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

function isEdgeTransportError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("failed to send a request to the edge function") ||
    normalized.includes("failed to fetch") ||
    normalized.includes("networkerror") ||
    normalized.includes("load failed") ||
    normalized === "request_timeout" ||
    normalized === "origin_not_allowed" ||
    normalized === "allowed_origins_not_configured"
  );
}

async function parseFunctionError(error: unknown): Promise<string> {
  const fnError = error as { message?: string; context?: Response };
  if (fnError.context) {
    try {
      const body = (await fnError.context.json()) as { error?: string; code?: string };
      const codeOrError = body.code ?? body.error;
      if (codeOrError && isEdgeTransportError(codeOrError)) {
        return "integrations.googleCalendar.errorEdgeFunctionUnreachable";
      }
      if (body.code) return body.code;
      if (body.error) return body.error;
    } catch {
      /* ignore parse failure */
    }
  }
  const message = fnError.message ?? "request_failed";
  if (isEdgeTransportError(message)) {
    return "integrations.googleCalendar.errorEdgeFunctionUnreachable";
  }
  return message;
}

async function invokeFunction<T extends EdgePayload>(
  name: string,
  body?: Record<string, unknown>,
  options?: { signal?: AbortSignal; timeoutMs?: number }
): Promise<T> {
  const { signal, timeoutMs = 30_000 } = options ?? {};

  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    throw new Error("not_authenticated");
  }

  const invokePromise = supabase.functions.invoke(name, { body });

  const { data, error } = await new Promise<{
    data: unknown;
    error: unknown;
  }>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error("request_timeout"));
    }, timeoutMs);

    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };

    signal?.addEventListener("abort", onAbort, { once: true });

    void invokePromise
      .then((result) => {
        window.clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(result);
      })
      .catch((invokeError: unknown) => {
        window.clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(invokeError);
      });
  });

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
      "id, organization_id, organization_member_id, google_account_id, calendar_id, calendar_name, timezone, enabled, sync_group, sync_personal, sync_events, privacy_mode, last_success_at, last_error_at, last_error_code, cleanup_pending, disabled_at, freebusy_calendar_ids, created_at, updated_at"
    )
    .eq("organization_member_id", organizationMemberId)
    .eq("enabled", true)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as MemberGoogleCalendarBinding | null) ?? null;
}

export async function fetchOrganizationGoogleBinding(): Promise<OrganizationGoogleCalendarBinding | null> {
  const { data, error } = await supabase
    .from("organization_google_calendar_bindings")
    .select(
      "id, organization_id, google_account_id, configured_by_member_id, calendar_id, calendar_name, timezone, enabled, last_success_at, last_error_at, last_error_code, cleanup_pending, disabled_at, created_at, updated_at"
    )
    .eq("enabled", true)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as OrganizationGoogleCalendarBinding | null) ?? null;
}

export async function startGoogleCalendarOAuth(
  returnUrl: string,
  options?: { consentPurpose?: string }
): Promise<string> {
  const payload = await invokeFunction<{ ok: boolean; url?: string }>(
    "google-calendar-auth-start",
    {
      return_url: returnUrl,
      consent_purpose: options?.consentPurpose,
    }
  );
  if (!payload.url) throw new Error("missing_oauth_url");
  return payload.url;
}

export async function listGoogleCalendars(
  googleAccountId: string,
  options?: { purpose?: "freebusy" }
): Promise<GoogleCalendarListEntry[]> {
  const payload = await invokeFunction<{ ok: boolean; calendars?: GoogleCalendarListEntry[] }>(
    "google-calendar-list-calendars",
    {
      google_account_id: googleAccountId,
      purpose: options?.purpose,
    }
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

export async function setOrganizationGoogleCalendarBinding(input: {
  googleAccountId: string;
  calendarId: string;
  calendarName: string;
  timezone: string;
  deleteOldEvents?: boolean;
}): Promise<void> {
  await invokeFunction("google-calendar-set-org-binding", {
    google_account_id: input.googleAccountId,
    calendar_id: input.calendarId,
    calendar_name: input.calendarName,
    timezone: input.timezone,
    delete_old_events: input.deleteOldEvents ?? false,
  });
}

export async function disconnectGoogleCalendar(input: {
  organizationMemberId?: string;
  organizationBindingId?: string;
  deleteFutureEvents?: boolean;
  revokeAccount?: boolean;
  googleAccountId?: string;
}): Promise<void> {
  await invokeFunction("google-calendar-disconnect", {
    organization_member_id: input.organizationMemberId,
    organization_binding_id: input.organizationBindingId,
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

export async function kickCalendarSync(organizationId: string): Promise<void> {
  if (!organizationId) return;
  await invokeFunction("calendar-sync-kick", { organization_id: organizationId }, {
    timeoutMs: 55_000,
  });
}

export function kickCalendarSyncInBackground(organizationId: string | null | undefined): void {
  if (!organizationId) return;
  void kickCalendarSync(organizationId).catch(() => {
    /* queue still processed by cron */
  });
}

export async function requestMemberCalendarReconcile(
  organizationMemberId: string,
  organizationId?: string | null
): Promise<void> {
  const { data, error } = await supabase.rpc("request_member_calendar_reconcile", {
    p_organization_member_id: organizationMemberId,
  });
  if (error) throw new Error(error.message);
  const payload = data as { ok?: boolean } | null;
  if (payload && payload.ok !== true) {
    throw new Error("reconcile_request_failed");
  }
  if (organizationId) {
    await kickCalendarSync(organizationId);
  }
}

export async function requestOrganizationCalendarReconcile(
  organizationId?: string | null
): Promise<void> {
  const { data, error } = await supabase.rpc("request_organization_calendar_reconcile");
  if (error) throw new Error(error.message);
  const payload = data as { skipped?: boolean } | null;
  if (!payload) {
    throw new Error("reconcile_request_failed");
  }
  if (organizationId) {
    await kickCalendarSync(organizationId);
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

export async function retryOrganizationCalendarSyncDeadJobs(): Promise<{
  deleted_duplicates: number;
  requeued: number;
}> {
  const { data, error } = await supabase.rpc("retry_organization_calendar_sync_dead_jobs");
  if (error) throw new Error(error.message);
  const payload = data as {
    ok?: boolean;
    deleted_duplicates?: number;
    requeued?: number;
  } | null;
  if (!payload?.ok) {
    throw new Error("retry_failed");
  }
  return {
    deleted_duplicates: payload.deleted_duplicates ?? 0,
    requeued: payload.requeued ?? 0,
  };
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
  | "not_connected"
  | "detached"
  | "unknown"
  | "stale";

/** Poll interval while a real pending job is in flight (see useGoogleCalendarSyncStatus). */
export const GOOGLE_CALENDAR_SYNC_POLL_INTERVAL_MS = 15_000;
/** Max RPC polls before showing stale badge and stopping interval (20 × 15s ≈ 5 min). */
export const GOOGLE_CALENDAR_SYNC_MAX_POLL_COUNT = 20;

export interface PersonalLessonGoogleSyncStatus {
  sync_status: string | null;
  last_synced_at: string | null;
  last_error: string | null;
  has_pending_job: boolean;
  teacher_has_binding: boolean;
  calendar_name: string | null;
}

export type ScheduleEntryGoogleSyncStatus = PersonalLessonGoogleSyncStatus;

export type GoogleCalendarSyncTarget =
  | { sourceType: "personal_lesson"; sourceId: string }
  | { sourceType: "group_occurrence"; sourceId: string; occurrenceDate: string };

export function googleCalendarSyncTargetFromLesson(
  lesson: { kind: "personal"; lessonId: string } | { kind: "group"; slotId: string; date: string } | null | undefined
): GoogleCalendarSyncTarget | null {
  if (!lesson) return null;
  if (lesson.kind === "personal") {
    return { sourceType: "personal_lesson", sourceId: lesson.lessonId };
  }
  return {
    sourceType: "group_occurrence",
    sourceId: lesson.slotId,
    occurrenceDate: lesson.date,
  };
}

export function resolveLessonGoogleSyncUiStatus(
  row: PersonalLessonGoogleSyncStatus | null | undefined
): LessonGoogleSyncUiStatus | null {
  if (!row) return null;
  if (!row.teacher_has_binding) return "not_connected";
  if (row.has_pending_job) return "pending";
  if (row.sync_status === "failed" || Boolean(row.last_error)) return "error";
  if (row.sync_status === "synced") return "synced";
  if (row.sync_status === "detached") return "detached";
  if (row.sync_status === "pending") return "stale";
  return "unknown";
}

export function resolveLessonGoogleSyncUiStatusWithPollCap(
  row: PersonalLessonGoogleSyncStatus | null | undefined,
  dataUpdateCount: number
): LessonGoogleSyncUiStatus | null {
  const ui = resolveLessonGoogleSyncUiStatus(row);
  if (
    ui === "pending" &&
    dataUpdateCount >= GOOGLE_CALENDAR_SYNC_MAX_POLL_COUNT
  ) {
    return "stale";
  }
  return ui;
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

export async function fetchGroupOccurrenceGoogleSyncStatus(
  slotId: string,
  occurrenceDate: string
): Promise<ScheduleEntryGoogleSyncStatus | null> {
  const { data, error } = await supabase.rpc("get_group_occurrence_google_sync_status", {
    p_slot_id: slotId,
    p_occurrence_date: occurrenceDate,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return row as ScheduleEntryGoogleSyncStatus;
}

export async function fetchScheduleEntryGoogleSyncStatus(
  target: GoogleCalendarSyncTarget
): Promise<ScheduleEntryGoogleSyncStatus | null> {
  if (target.sourceType === "personal_lesson") {
    return fetchPersonalLessonGoogleSyncStatus(target.sourceId);
  }
  return fetchGroupOccurrenceGoogleSyncStatus(target.sourceId, target.occurrenceDate);
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

export async function setFreebusyCalendarConfig(input: {
  organizationMemberId: string;
  freebusyCalendarIds: string[];
}): Promise<string[]> {
  const payload = await invokeFunction<{
    ok: boolean;
    freebusy_calendar_ids?: string[];
  }>("google-calendar-set-freebusy-config", {
    organization_member_id: input.organizationMemberId,
    freebusy_calendar_ids: input.freebusyCalendarIds,
  });
  return payload.freebusy_calendar_ids ?? [];
}

export async function fetchTeacherGoogleFreebusy(
  input: {
    organizationMemberId: string;
    date: string;
    timeStart: string;
    timeEnd: string;
  },
  options?: { signal?: AbortSignal }
): Promise<{ busy: GoogleFreebusyInterval[]; configured: boolean }> {
  const payload = await invokeFunction<{
    ok: boolean;
    busy?: GoogleFreebusyInterval[];
    configured?: boolean;
  }>(
    "google-calendar-freebusy",
    {
      organization_member_id: input.organizationMemberId,
      date: input.date,
      time_start: input.timeStart,
      time_end: input.timeEnd,
    },
    { signal: options?.signal, timeoutMs: 15_000 }
  );
  return {
    busy: payload.busy ?? [],
    configured: payload.configured ?? false,
  };
}
