/**
 * Personal-lesson sync logic for calendar-sync-worker (GCAL Prompt 6).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildPersonalLessonGoogleEvent,
  googleEventIdFromUuid,
  hashGoogleEventPayload,
  type GoogleCalendarEventResource,
  type PrivacyMode,
  formatClientLabel,
} from "./calendarSyncPayload.ts";
import {
  deleteCalendarEvent,
  getCalendarEvent,
  GoogleCalendarApiError,
  insertCalendarEvent,
  obtainAccessTokenForGoogleAccount,
  updateCalendarEvent,
} from "./googleCalendarClient.ts";
import type { GoogleOAuthConfig } from "./googleOAuth.ts";
import { logEvent } from "./supabase.ts";

export const CANCEL_POLICY = "delete" as const;
export const MAX_SYNC_ATTEMPTS = 10;
export const LEASE_SECONDS = 300;

export type OutboxJob = {
  id: string;
  organization_id: string;
  source_type: string;
  source_id: string;
  occurrence_date: string | null;
  dedupe_key: string;
  operation: "upsert" | "delete" | "reconcile_member";
  attempt_count: number;
};

type EventLinkRow = {
  id: string;
  organization_id: string;
  recipient_kind: string;
  member_binding_id: string | null;
  organization_binding_id: string | null;
  source_type: string;
  source_id: string;
  occurrence_date: string;
  google_event_id: string | null;
  google_etag: string | null;
  desired_hash: string | null;
  sync_status: string;
  detach_reason: string | null;
};

type MemberBindingRow = {
  id: string;
  organization_id: string;
  organization_member_id: string;
  google_account_id: string;
  calendar_id: string;
  calendar_name: string;
  enabled: boolean;
  sync_personal: boolean;
  privacy_mode: string;
  cleanup_pending: boolean;
};

type BindingContext = MemberBindingRow & {
  calendar_id: string;
  google_account_id: string;
};

type PersonalLessonRow = {
  id: string;
  organization_id: string;
  type: string;
  date: string;
  time_start: string;
  time_end: string;
  client_id1: string | null;
  client_id2: string | null;
  client_id3: string | null;
  client_id4: string | null;
  discipline_id: string | null;
  location_id: string | null;
  teacher_member_id: string | null;
  cancelled_at: string | null;
  disciplines: { name: string } | { name: string }[] | null;
  locations: { name: string } | { name: string }[] | null;
};

type ClientRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
};

function nestedName(
  value: { name: string } | { name: string }[] | null | undefined
): string | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0]?.name ?? null;
  return value.name ?? null;
}

function computeRetryDelayMs(attemptCount: number): number {
  const base = 30_000;
  const max = 3_600_000;
  const exp = Math.min(base * 2 ** attemptCount, max);
  const jitter = Math.floor(Math.random() * 10_000);
  return exp + jitter;
}

function siteUrl(): string {
  return (Deno.env.get("SITE_URL") ?? "https://tangodb.vercel.app").replace(/\/$/, "");
}

async function markJobDone(admin: SupabaseClient, jobId: string): Promise<void> {
  const nowIso = new Date().toISOString();
  await admin
    .from("calendar_sync_outbox")
    .update({
      status: "done",
      processed_at: nowIso,
      locked_at: null,
      locked_by: null,
      last_error_code: null,
      last_error_message: null,
    })
    .eq("id", jobId);
}

async function markJobRetry(
  admin: SupabaseClient,
  job: OutboxJob,
  errorCode: string,
  errorMessage: string
): Promise<void> {
  const nextAttempt = job.attempt_count + 1;
  const delayMs = computeRetryDelayMs(nextAttempt);
  const availableAt = new Date(Date.now() + delayMs).toISOString();

  if (nextAttempt >= MAX_SYNC_ATTEMPTS) {
    await admin
      .from("calendar_sync_outbox")
      .update({
        status: "dead",
        attempt_count: nextAttempt,
        available_at: availableAt,
        locked_at: null,
        locked_by: null,
        last_error_code: errorCode,
        last_error_message: errorMessage.slice(0, 500),
        processed_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    return;
  }

  await admin
    .from("calendar_sync_outbox")
    .update({
      status: "retry",
      attempt_count: nextAttempt,
      available_at: availableAt,
      locked_at: null,
      locked_by: null,
      last_error_code: errorCode,
      last_error_message: errorMessage.slice(0, 500),
    })
    .eq("id", job.id);
}

async function loadOrgContext(
  admin: SupabaseClient,
  organizationId: string
): Promise<{ timezone: string; organizationName: string }> {
  const [{ data: settings }, { data: org }] = await Promise.all([
    admin
      .from("organization_settings")
      .select("timezone")
      .eq("organization_id", organizationId)
      .maybeSingle(),
    admin.from("organizations").select("name").eq("id", organizationId).maybeSingle(),
  ]);

  return {
    timezone: (settings?.timezone as string | undefined) ?? "Europe/Moscow",
    organizationName: (org?.name as string | undefined) ?? "TangoDB",
  };
}

async function loadActiveBinding(
  admin: SupabaseClient,
  organizationId: string,
  teacherMemberId: string
): Promise<MemberBindingRow | null> {
  const { data } = await admin
    .from("member_google_calendar_bindings")
    .select(
      "id, organization_id, organization_member_id, google_account_id, calendar_id, calendar_name, enabled, sync_personal, privacy_mode, cleanup_pending"
    )
    .eq("organization_id", organizationId)
    .eq("organization_member_id", teacherMemberId)
    .eq("enabled", true)
    .maybeSingle();

  return (data as MemberBindingRow | null) ?? null;
}

async function loadBindingById(
  admin: SupabaseClient,
  organizationId: string,
  bindingId: string
): Promise<BindingContext | null> {
  const { data } = await admin
    .from("member_google_calendar_bindings")
    .select(
      "id, organization_id, organization_member_id, google_account_id, calendar_id, calendar_name, enabled, sync_personal, privacy_mode, cleanup_pending"
    )
    .eq("organization_id", organizationId)
    .eq("id", bindingId)
    .maybeSingle();

  return (data as BindingContext | null) ?? null;
}

async function isTeacherActive(
  admin: SupabaseClient,
  organizationId: string,
  teacherMemberId: string
): Promise<boolean> {
  const { data } = await admin
    .from("organization_members")
    .select("is_active")
    .eq("organization_id", organizationId)
    .eq("id", teacherMemberId)
    .maybeSingle();

  return data?.is_active === true;
}

async function loadClients(
  admin: SupabaseClient,
  organizationId: string,
  ids: string[]
): Promise<Map<string, ClientRow>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, ClientRow>();
  if (!unique.length) return map;

  const { data } = await admin
    .from("clients")
    .select("id, first_name, last_name")
    .eq("organization_id", organizationId)
    .in("id", unique);

  for (const row of (data ?? []) as ClientRow[]) {
    map.set(row.id, row);
  }
  return map;
}

function clientIdsForLesson(lesson: PersonalLessonRow): string[] {
  return [lesson.client_id1, lesson.client_id2, lesson.client_id3, lesson.client_id4].filter(
    (id): id is string => Boolean(id)
  );
}

function clientLabelsForLesson(
  lesson: PersonalLessonRow,
  clients: Map<string, ClientRow>,
  privacyMode: PrivacyMode
): string[] {
  const ids = clientIdsForLesson(lesson);
  if (lesson.type === "solo" && ids.length === 0) {
    return privacyMode === "hidden" ? [] : [];
  }
  return ids.map((id) => {
    const client = clients.get(id);
    return formatClientLabel(client?.first_name ?? null, client?.last_name ?? null, privacyMode);
  });
}

async function loadLesson(
  admin: SupabaseClient,
  organizationId: string,
  lessonId: string
): Promise<PersonalLessonRow | null> {
  const { data } = await admin
    .from("personal_lessons")
    .select(
      "id, organization_id, type, date, time_start, time_end, client_id1, client_id2, client_id3, client_id4, discipline_id, location_id, teacher_member_id, cancelled_at, disciplines(name), locations(name)"
    )
    .eq("organization_id", organizationId)
    .eq("id", lessonId)
    .maybeSingle();

  return (data as PersonalLessonRow | null) ?? null;
}

async function loadLinksForSource(
  admin: SupabaseClient,
  organizationId: string,
  sourceType: string,
  sourceId: string
): Promise<EventLinkRow[]> {
  const { data } = await admin
    .from("google_calendar_event_links")
    .select(
      "id, organization_id, recipient_kind, member_binding_id, organization_binding_id, source_type, source_id, occurrence_date, google_event_id, google_etag, desired_hash, sync_status, detach_reason"
    )
    .eq("organization_id", organizationId)
    .eq("source_type", sourceType)
    .eq("source_id", sourceId);

  return (data as EventLinkRow[] | null) ?? [];
}

async function deleteLinkRow(admin: SupabaseClient, linkId: string): Promise<void> {
  await admin.from("google_calendar_event_links").delete().eq("id", linkId);
}

async function markLinkDetached(
  admin: SupabaseClient,
  linkId: string,
  reason: string
): Promise<void> {
  const nowIso = new Date().toISOString();
  await admin
    .from("google_calendar_event_links")
    .update({
      sync_status: "detached",
      detach_reason: reason,
      updated_at: nowIso,
    })
    .eq("id", linkId);
}

async function maybeClearBindingCleanup(
  admin: SupabaseClient,
  organizationId: string,
  bindingId: string
): Promise<void> {
  const binding = await loadBindingById(admin, organizationId, bindingId);
  if (!binding?.cleanup_pending) return;

  const { count } = await admin
    .from("google_calendar_event_links")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("member_binding_id", bindingId);

  if ((count ?? 0) > 0) return;

  await admin
    .from("member_google_calendar_bindings")
    .update({
      cleanup_pending: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", bindingId);
}

async function deleteGoogleEventForLink(
  admin: SupabaseClient,
  config: GoogleOAuthConfig,
  link: EventLinkRow
): Promise<void> {
  if (!link.google_event_id || !link.member_binding_id) return;

  const binding = await loadBindingById(admin, link.organization_id, link.member_binding_id);
  if (!binding) return;
  if (!binding.enabled && !binding.cleanup_pending) return;

  try {
    const accessToken = await obtainAccessTokenForGoogleAccount(
      admin,
      config,
      binding.google_account_id
    );
    await deleteCalendarEvent(accessToken, binding.calendar_id, link.google_event_id);
  } catch (err) {
    if (err instanceof GoogleCalendarApiError && (err.status === 404 || err.status === 410)) {
      return;
    }
    throw err;
  }
}

async function removeStaleLinks(
  admin: SupabaseClient,
  config: GoogleOAuthConfig,
  links: EventLinkRow[],
  currentBindingId: string,
  currentOccurrenceDate: string
): Promise<void> {
  for (const link of links) {
    const stale =
      link.occurrence_date !== currentOccurrenceDate ||
      link.member_binding_id !== currentBindingId;
    if (!stale) continue;

    await deleteGoogleEventForLink(admin, config, link);
    await deleteLinkRow(admin, link.id);
    if (link.member_binding_id) {
      await maybeClearBindingCleanup(admin, link.organization_id, link.member_binding_id);
    }
  }
}

async function upsertLinkRow(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    memberBindingId: string;
    sourceType: string;
    sourceId: string;
    occurrenceDate: string;
    googleEventId: string;
    googleEtag: string;
    desiredHash: string;
  }
): Promise<string> {
  const nowIso = new Date().toISOString();
  const { data: existing } = await admin
    .from("google_calendar_event_links")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("member_binding_id", input.memberBindingId)
    .eq("source_type", input.sourceType)
    .eq("source_id", input.sourceId)
    .eq("occurrence_date", input.occurrenceDate)
    .maybeSingle();

  if (existing?.id) {
    await admin
      .from("google_calendar_event_links")
      .update({
        google_event_id: input.googleEventId,
        google_etag: input.googleEtag,
        desired_hash: input.desiredHash,
        sync_status: "synced",
        detach_reason: null,
        last_synced_at: nowIso,
        last_error: null,
        updated_at: nowIso,
      })
      .eq("id", existing.id);
    return existing.id as string;
  }

  const { data: inserted, error } = await admin
    .from("google_calendar_event_links")
    .insert({
      organization_id: input.organizationId,
      recipient_kind: "member",
      member_binding_id: input.memberBindingId,
      organization_binding_id: null,
      source_type: input.sourceType,
      source_id: input.sourceId,
      occurrence_date: input.occurrenceDate,
      google_event_id: input.googleEventId,
      google_etag: input.googleEtag,
      desired_hash: input.desiredHash,
      sync_status: "synced",
      last_synced_at: nowIso,
      updated_at: nowIso,
    })
    .select("id")
    .single();

  if (error || !inserted) {
    throw new Error(error?.message ?? "link_insert_failed");
  }
  return inserted.id as string;
}

async function recordBindingSuccess(
  admin: SupabaseClient,
  bindingId: string
): Promise<void> {
  const nowIso = new Date().toISOString();
  await admin
    .from("member_google_calendar_bindings")
    .update({
      last_success_at: nowIso,
      last_error_at: null,
      last_error_code: null,
      updated_at: nowIso,
    })
    .eq("id", bindingId);
}

async function recordBindingError(
  admin: SupabaseClient,
  bindingId: string,
  code: string
): Promise<void> {
  const nowIso = new Date().toISOString();
  await admin
    .from("member_google_calendar_bindings")
    .update({
      last_error_at: nowIso,
      last_error_code: code,
      updated_at: nowIso,
    })
    .eq("id", bindingId);
}

async function buildLessonPayload(
  admin: SupabaseClient,
  lesson: PersonalLessonRow,
  privacyMode: PrivacyMode,
  cancelledMark: boolean
): Promise<GoogleCalendarEventResource> {
  const orgContext = await loadOrgContext(admin, lesson.organization_id);
  const clients = await loadClients(admin, lesson.organization_id, clientIdsForLesson(lesson));
  const clientLabels = clientLabelsForLesson(lesson, clients, privacyMode);

  return buildPersonalLessonGoogleEvent({
    lessonId: lesson.id,
    organizationId: lesson.organization_id,
    date: lesson.date,
    timeStart: lesson.time_start,
    timeEnd: lesson.time_end,
    timeZone: orgContext.timezone,
    disciplineName: nestedName(lesson.disciplines),
    locationName: nestedName(lesson.locations),
    clientLabels,
    organizationName: orgContext.organizationName,
    scheduleUrl: `${siteUrl()}/schedule`,
    cancelledMark,
  });
}

async function syncEventToGoogle(
  admin: SupabaseClient,
  config: GoogleOAuthConfig,
  binding: MemberBindingRow,
  payload: GoogleCalendarEventResource,
  desiredHash: string,
  deterministicEventId: string,
  existingLink: EventLinkRow | null
): Promise<{ eventId: string; etag: string }> {
  const accessToken = await obtainAccessTokenForGoogleAccount(
    admin,
    config,
    binding.google_account_id
  );

  if (!existingLink?.google_event_id) {
    try {
      const created = await insertCalendarEvent(
        accessToken,
        binding.calendar_id,
        payload,
        deterministicEventId
      );
      return { eventId: created.id, etag: created.etag };
    } catch (err) {
      if (err instanceof GoogleCalendarApiError && err.status === 409) {
        const existing = await getCalendarEvent(
          accessToken,
          binding.calendar_id,
          deterministicEventId
        );
        const updated = await updateCalendarEvent(
          accessToken,
          binding.calendar_id,
          existing.id,
          payload,
          existing.etag
        );
        return { eventId: updated.id, etag: updated.etag };
      }
      throw err;
    }
  }

  if (existingLink.desired_hash === desiredHash && existingLink.sync_status === "synced") {
    return {
      eventId: existingLink.google_event_id,
      etag: existingLink.google_etag ?? "",
    };
  }

  if (existingLink.sync_status === "detached") {
    throw new GoogleCalendarApiError(409, "detached", "Event link is detached");
  }

  try {
    const updated = await updateCalendarEvent(
      accessToken,
      binding.calendar_id,
      existingLink.google_event_id,
      payload,
      existingLink.google_etag
    );
    return { eventId: updated.id, etag: updated.etag };
  } catch (err) {
    if (!(err instanceof GoogleCalendarApiError)) throw err;

    if (err.status === 412) {
      const fresh = await getCalendarEvent(
        accessToken,
        binding.calendar_id,
        existingLink.google_event_id
      );
      const updated = await updateCalendarEvent(
        accessToken,
        binding.calendar_id,
        fresh.id,
        payload,
        fresh.etag
      );
      return { eventId: updated.id, etag: updated.etag };
    }

    if (err.status === 404) {
      const created = await insertCalendarEvent(
        accessToken,
        binding.calendar_id,
        payload,
        deterministicEventId
      );
      return { eventId: created.id, etag: created.etag };
    }

    throw err;
  }
}

export async function deletePersonalLessonOccurrence(
  admin: SupabaseClient,
  config: GoogleOAuthConfig,
  job: OutboxJob
): Promise<void> {
  if (!job.occurrence_date) {
    await markJobDone(admin, job.id);
    return;
  }

  const links = (await loadLinksForSource(
    admin,
    job.organization_id,
    "personal_lesson",
    job.source_id
  )).filter((link) => link.occurrence_date === job.occurrence_date);

  for (const link of links) {
    await deleteGoogleEventForLink(admin, config, link);
    await deleteLinkRow(admin, link.id);
    if (link.member_binding_id) {
      await maybeClearBindingCleanup(admin, job.organization_id, link.member_binding_id);
    }
  }

  await markJobDone(admin, job.id);
  logEvent("gcal_sync_delete_done", {
    organization_id: job.organization_id,
    source_type: job.source_type,
    source_id: job.source_id,
    occurrence_date: job.occurrence_date,
  });
}

export async function upsertPersonalLesson(
  admin: SupabaseClient,
  config: GoogleOAuthConfig,
  job: OutboxJob
): Promise<void> {
  const lesson = await loadLesson(admin, job.organization_id, job.source_id);

  if (!lesson) {
    await deletePersonalLessonOccurrence(admin, config, job);
    return;
  }

  const occurrenceDate = job.occurrence_date ?? lesson.date;

  if (lesson.cancelled_at) {
    if (CANCEL_POLICY === "delete") {
      await deletePersonalLessonOccurrence(admin, config, {
        ...job,
        occurrence_date: occurrenceDate,
        operation: "delete",
      });
      return;
    }
    // mark_cancelled path — future optional setting
  }

  if (!lesson.teacher_member_id) {
    await markJobDone(admin, job.id);
    return;
  }

  const teacherActive = await isTeacherActive(
    admin,
    job.organization_id,
    lesson.teacher_member_id
  );
  if (!teacherActive) {
    await markJobDone(admin, job.id);
    return;
  }

  const binding = await loadActiveBinding(
    admin,
    job.organization_id,
    lesson.teacher_member_id
  );
  if (!binding || !binding.sync_personal) {
    await markJobDone(admin, job.id);
    return;
  }

  const privacyMode = (binding.privacy_mode as PrivacyMode) || "initials";
  const cancelledMark = false;
  const payload = await buildLessonPayload(admin, lesson, privacyMode, cancelledMark);
  const desiredHash = await hashGoogleEventPayload(payload);
  const deterministicEventId = googleEventIdFromUuid(lesson.id);

  const allLinks = await loadLinksForSource(
    admin,
    job.organization_id,
    "personal_lesson",
    lesson.id
  );
  await removeStaleLinks(admin, config, allLinks, binding.id, occurrenceDate);

  const currentLink =
    allLinks.find(
      (link) =>
        link.member_binding_id === binding.id &&
        link.occurrence_date === occurrenceDate &&
        link.sync_status !== "detached"
    ) ?? null;

  const detachedLink = allLinks.find(
    (link) =>
      link.member_binding_id === binding.id &&
      link.occurrence_date === occurrenceDate &&
      link.sync_status === "detached"
  );
  if (detachedLink) {
    await markJobDone(admin, job.id);
    return;
  }

  if (currentLink?.desired_hash === desiredHash && currentLink.sync_status === "synced") {
    await markJobDone(admin, job.id);
    return;
  }

  try {
    const { eventId, etag } = await syncEventToGoogle(
      admin,
      config,
      binding,
      payload,
      desiredHash,
      deterministicEventId,
      currentLink
    );

    await upsertLinkRow(admin, {
      organizationId: job.organization_id,
      memberBindingId: binding.id,
      sourceType: "personal_lesson",
      sourceId: lesson.id,
      occurrenceDate,
      googleEventId: eventId,
      googleEtag: etag,
      desiredHash,
    });
    await recordBindingSuccess(admin, binding.id);
    await markJobDone(admin, job.id);

    logEvent("gcal_sync_upsert_done", {
      organization_id: job.organization_id,
      source_type: job.source_type,
      source_id: job.source_id,
      occurrence_date: occurrenceDate,
      link_status: "synced",
    });
  } catch (err) {
    const apiErr = err instanceof GoogleCalendarApiError ? err : null;
    const code = apiErr?.code ?? "sync_failed";
    const message = apiErr?.message ?? (err instanceof Error ? err.message : "unknown");

    if (apiErr?.status === 403) {
      await recordBindingError(admin, binding.id, code);
    }

    if (currentLink) {
      await admin
        .from("google_calendar_event_links")
        .update({
          sync_status: "failed",
          last_error: message.slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq("id", currentLink.id);
    }

    const retryable =
      !apiErr ||
      apiErr.status === 429 ||
      apiErr.status >= 500 ||
      apiErr.code === "backendError" ||
      apiErr.code === "rateLimitExceeded";

    const deadImmediately =
      apiErr?.status === 401 ||
      apiErr?.code === "token_revoked" ||
      apiErr?.code === "token_missing";

    if (deadImmediately) {
      await admin
        .from("calendar_sync_outbox")
        .update({
          status: "dead",
          attempt_count: job.attempt_count + 1,
          locked_at: null,
          locked_by: null,
          last_error_code: code,
          last_error_message: message.slice(0, 500),
          processed_at: new Date().toISOString(),
        })
        .eq("id", job.id);
    } else if (retryable) {
      await markJobRetry(admin, job, code, message);
    } else {
      await markJobRetry(admin, job, code, message);
    }

    logEvent("gcal_sync_job_error", {
      organization_id: job.organization_id,
      source_type: job.source_type,
      source_id: job.source_id,
      error_code: code,
      http_status: apiErr?.status ?? null,
    });
  }
}

export async function processCalendarSyncJob(
  admin: SupabaseClient,
  config: GoogleOAuthConfig,
  job: OutboxJob
): Promise<void> {
  if (job.source_type !== "personal_lesson") {
    await markJobDone(admin, job.id);
    return;
  }

  if (job.operation === "reconcile_member") {
    await markJobDone(admin, job.id);
    return;
  }

  if (job.operation === "delete") {
    await deletePersonalLessonOccurrence(admin, config, job);
    return;
  }

  await upsertPersonalLesson(admin, config, job);
}
