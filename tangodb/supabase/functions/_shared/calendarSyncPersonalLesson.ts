/**
 * Personal-lesson sync logic for calendar-sync-worker (GCAL Prompt 6).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildPersonalLessonGoogleEvent,
  googleEventIdFromUuid,
  hashGoogleEventPayload,
  type PrivacyMode,
  formatClientLabel,
} from "./calendarSyncPayload.ts";
import {
  CANCEL_POLICY,
  type OutboxJob,
  siteUrl,
  nestedName,
  markJobDone,
  loadOrgContext,
  loadActiveBinding,
  isTeacherActive,
  loadLinksForSource,
  deleteGoogleEventForLink,
  deleteLinkRow,
  maybeClearBindingCleanup,
  removeStaleLinks,
  upsertLinkRow,
  recordBindingSuccess,
  syncEventToGoogle,
  handleSyncJobError,
} from "./calendarSyncCommon.ts";
import type { GoogleOAuthConfig } from "./googleOAuth.ts";
import { logEvent } from "./supabase.ts";
import {
  deleteGroupOccurrence,
  upsertGroupOccurrence,
} from "./calendarSyncGroupOccurrence.ts";
import {
  deleteEventSession,
  upsertEventSession,
} from "./calendarSyncEventSession.ts";

export { CANCEL_POLICY, LEASE_SECONDS, type OutboxJob } from "./calendarSyncCommon.ts";

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

async function buildLessonPayload(
  admin: SupabaseClient,
  lesson: PersonalLessonRow,
  privacyMode: PrivacyMode,
  cancelledMark: boolean
) {
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
    lesson.teacher_member_id,
    "sync_personal"
  );
  if (!binding) {
    await markJobDone(admin, job.id);
    return;
  }

  const privacyMode = (binding.privacy_mode as PrivacyMode) || "initials";
  const payload = await buildLessonPayload(admin, lesson, privacyMode, false);
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
    await handleSyncJobError(admin, job, binding.id, null, currentLink, err);

    const apiErr = err instanceof Error ? err : null;
    logEvent("gcal_sync_job_error", {
      organization_id: job.organization_id,
      source_type: job.source_type,
      source_id: job.source_id,
      error_code: apiErr?.message ?? "sync_failed",
      http_status: null,
    });
  }
}

async function runReconcileMember(
  admin: SupabaseClient,
  job: OutboxJob
): Promise<void> {
  const { data: personalResult, error: personalError } = await admin.rpc(
    "execute_member_personal_lessons_reconcile",
    {
      p_organization_id: job.organization_id,
      p_member_id: job.source_id,
    }
  );

  if (personalError) {
    throw new Error(personalError.message);
  }

  const { data: groupResult, error: groupError } = await admin.rpc(
    "execute_member_group_occurrences_reconcile",
    {
      p_organization_id: job.organization_id,
      p_member_id: job.source_id,
    }
  );

  if (groupError) {
    throw new Error(groupError.message);
  }

  const personal = (personalResult ?? {}) as {
    skipped?: boolean;
    upserts_enqueued?: number;
    deletes_enqueued?: number;
  };
  const group = (groupResult ?? {}) as {
    skipped?: boolean;
    upserts_enqueued?: number;
    deletes_enqueued?: number;
  };

  logEvent("gcal_reconcile_member_complete", {
    organization_id: job.organization_id,
    member_id: job.source_id,
    personal_skipped: personal.skipped ?? false,
    personal_upserts: personal.upserts_enqueued ?? 0,
    personal_deletes: personal.deletes_enqueued ?? 0,
    group_skipped: group.skipped ?? false,
    group_upserts: group.upserts_enqueued ?? 0,
    group_deletes: group.deletes_enqueued ?? 0,
  });

  await markJobDone(admin, job.id);
}

export async function processCalendarSyncJob(
  admin: SupabaseClient,
  config: GoogleOAuthConfig,
  job: OutboxJob
): Promise<void> {
  if (job.operation === "reconcile_member") {
    await runReconcileMember(admin, job);
    return;
  }

  if (job.source_type === "group_occurrence") {
    if (job.operation === "delete") {
      await deleteGroupOccurrence(admin, config, job);
      return;
    }
    await upsertGroupOccurrence(admin, config, job);
    return;
  }

  if (job.source_type === "event_session") {
    if (job.operation === "delete") {
      await deleteEventSession(admin, config, job);
      return;
    }
    await upsertEventSession(admin, config, job);
    return;
  }

  if (job.source_type !== "personal_lesson") {
    await markJobDone(admin, job.id);
    return;
  }

  if (job.operation === "delete") {
    await deletePersonalLessonOccurrence(admin, config, job);
    return;
  }

  await upsertPersonalLesson(admin, config, job);
}
