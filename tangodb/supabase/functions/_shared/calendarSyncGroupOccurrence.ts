/**
 * Group occurrence sync logic for calendar-sync-worker (GCAL Prompt 10).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildGroupOccurrenceGoogleEvent,
  googleEventIdForGroupOccurrence,
  hashGoogleEventPayload,
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
  recreateMemberBindingCalendar,
  syncEventToGoogle,
  cleanupStaleManagedEvents,
  handleSyncJobError,
} from "./calendarSyncCommon.ts";
import { GoogleCalendarApiError } from "./googleCalendarClient.ts";
import type { GoogleOAuthConfig } from "./googleOAuth.ts";
import { logEvent } from "./supabase.ts";

type ScheduleSlotRow = {
  id: string;
  organization_id: string;
  day_of_week: number;
  time: string;
  time_end: string;
  group_name: string | null;
  discipline_id: string | null;
  teacher_member_id: string | null;
  valid_from: string | null;
  valid_to: string | null;
  disciplines: { name: string } | { name: string }[] | null;
  locations: { name: string } | { name: string }[] | null;
};

function isoDayOfWeek(dateStr: string): number {
  const d = new Date(`${dateStr}T12:00:00`);
  const jsDay = d.getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

async function cleanupOverlappingGroupSlotEvents(
  admin: SupabaseClient,
  accessToken: string,
  calendarId: string,
  slot: ScheduleSlotRow,
  occurrenceDate: string,
  keepEventId: string
): Promise<void> {
  if (!slot.teacher_member_id) return;

  const { data: overlapping } = await admin
    .from("schedule_slots")
    .select("id, day_of_week, time, time_end, group_name, discipline_id, valid_from, valid_to")
    .eq("organization_id", slot.organization_id)
    .eq("teacher_member_id", slot.teacher_member_id)
    .eq("time", slot.time)
    .eq("time_end", slot.time_end)
    .neq("id", slot.id);

  const overlaps = (overlapping ?? []) as Array<{
    id: string;
    day_of_week: number;
    time: string;
    time_end: string;
    group_name: string | null;
    discipline_id: string | null;
    valid_from: string | null;
    valid_to: string | null;
  }>;

  const slotGroup = (slot.group_name ?? "").trim().toLowerCase();
  const slotDisciplineId = slot.discipline_id ?? null;

  for (const other of overlaps) {
    const otherGroup = (other.group_name ?? "").trim().toLowerCase();
    if (slotGroup && otherGroup && slotGroup !== otherGroup) continue;
    if (!slotGroup && !otherGroup && slotDisciplineId !== other.discipline_id) continue;
    if (!isGroupSlotOccurrenceDate(other as ScheduleSlotRow, occurrenceDate)) continue;

    await cleanupStaleManagedEvents(accessToken, calendarId, {
      sourceType: "group_occurrence",
      sourceId: other.id,
      occurrenceKey: occurrenceDate,
    }, keepEventId);
  }
}

export function isGroupSlotOccurrenceDate(slot: ScheduleSlotRow, occurrenceDate: string): boolean {
  if (isoDayOfWeek(occurrenceDate) !== slot.day_of_week) {
    return false;
  }

  const validFrom = slot.valid_from ?? "2000-01-01";
  if (occurrenceDate < validFrom) {
    return false;
  }

  if (slot.valid_to) {
    if (slot.valid_to <= validFrom) {
      return false;
    }
    if (occurrenceDate > slot.valid_to) {
      return false;
    }
  }

  return true;
}

async function loadScheduleSlot(
  admin: SupabaseClient,
  organizationId: string,
  slotId: string
): Promise<ScheduleSlotRow | null> {
  const { data } = await admin
    .from("schedule_slots")
    .select(
      "id, organization_id, day_of_week, time, time_end, group_name, discipline_id, teacher_member_id, valid_from, valid_to, disciplines(name), locations(name)"
    )
    .eq("organization_id", organizationId)
    .eq("id", slotId)
    .maybeSingle();

  return (data as ScheduleSlotRow | null) ?? null;
}

async function isOccurrenceCancelled(
  admin: SupabaseClient,
  organizationId: string,
  slotId: string,
  occurrenceDate: string
): Promise<boolean> {
  const { data } = await admin
    .from("schedule_occurrence_cancellations")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("slot_id", slotId)
    .eq("occurrence_date", occurrenceDate)
    .maybeSingle();

  return Boolean(data);
}

async function buildGroupPayload(
  admin: SupabaseClient,
  slot: ScheduleSlotRow,
  occurrenceDate: string
) {
  const orgContext = await loadOrgContext(admin, slot.organization_id);

  return buildGroupOccurrenceGoogleEvent({
    slotId: slot.id,
    organizationId: slot.organization_id,
    occurrenceDate,
    timeStart: slot.time,
    timeEnd: slot.time_end,
    timeZone: orgContext.timezone,
    groupName: slot.group_name,
    disciplineName: nestedName(slot.disciplines),
    locationName: nestedName(slot.locations),
    organizationName: orgContext.organizationName,
    scheduleUrl: `${siteUrl()}/schedule`,
  });
}

export async function deleteGroupOccurrence(
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
    "group_occurrence",
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

export async function upsertGroupOccurrence(
  admin: SupabaseClient,
  config: GoogleOAuthConfig,
  job: OutboxJob
): Promise<void> {
  if (!job.occurrence_date) {
    await markJobDone(admin, job.id);
    return;
  }

  const occurrenceDate = job.occurrence_date;
  const slot = await loadScheduleSlot(admin, job.organization_id, job.source_id);

  if (!slot) {
    await deleteGroupOccurrence(admin, config, job);
    return;
  }

  const shouldDelete =
    !isGroupSlotOccurrenceDate(slot, occurrenceDate) ||
    (await isOccurrenceCancelled(admin, job.organization_id, slot.id, occurrenceDate));

  if (shouldDelete) {
    if (CANCEL_POLICY === "delete") {
      await deleteGroupOccurrence(admin, config, {
        ...job,
        operation: "delete",
      });
      return;
    }
  }

  if (!slot.teacher_member_id) {
    await markJobDone(admin, job.id);
    return;
  }

  const teacherActive = await isTeacherActive(
    admin,
    job.organization_id,
    slot.teacher_member_id
  );
  if (!teacherActive) {
    await markJobDone(admin, job.id);
    return;
  }

  const binding = await loadActiveBinding(
    admin,
    job.organization_id,
    slot.teacher_member_id,
    "sync_group"
  );
  if (!binding) {
    await markJobDone(admin, job.id);
    return;
  }

  const payload = await buildGroupPayload(admin, slot, occurrenceDate);
  const desiredHash = await hashGoogleEventPayload(payload);
  const deterministicEventId = googleEventIdForGroupOccurrence(slot.id, occurrenceDate);

  const allLinks = await loadLinksForSource(
    admin,
    job.organization_id,
    "group_occurrence",
    slot.id
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

  let targetBinding = binding;

  const syncAndSave = async () => {
    const { eventId, etag, accessToken, recoveredFromConflict } = await syncEventToGoogle(
      admin,
      config,
      targetBinding,
      payload,
      desiredHash,
      deterministicEventId,
      currentLink
    );

    if (recoveredFromConflict) {
      await cleanupStaleManagedEvents(
        accessToken,
        targetBinding.calendar_id,
        {
          sourceType: "group_occurrence",
          sourceId: slot.id,
          occurrenceKey: occurrenceDate,
        },
        eventId
      );
    }
    await cleanupOverlappingGroupSlotEvents(
      admin,
      accessToken,
      targetBinding.calendar_id,
      slot,
      occurrenceDate,
      eventId
    );

    await upsertLinkRow(admin, {
      organizationId: job.organization_id,
      memberBindingId: targetBinding.id,
      sourceType: "group_occurrence",
      sourceId: slot.id,
      occurrenceDate,
      googleEventId: eventId,
      googleEtag: etag,
      desiredHash,
    });
  };

  try {
    try {
      await syncAndSave();
    } catch (err) {
      const canRepairMissingCalendar =
        !currentLink &&
        err instanceof GoogleCalendarApiError &&
        err.status === 404;
      if (!canRepairMissingCalendar) throw err;

      const repairedBinding = await recreateMemberBindingCalendar(
        admin,
        config,
        targetBinding
      );
      if (!repairedBinding) throw err;
      targetBinding = repairedBinding;
      await syncAndSave();
    }

    await recordBindingSuccess(admin, targetBinding.id);
    await markJobDone(admin, job.id);

    logEvent("gcal_sync_upsert_done", {
      organization_id: job.organization_id,
      source_type: job.source_type,
      source_id: job.source_id,
      occurrence_date: occurrenceDate,
      link_status: "synced",
    });
  } catch (err) {
    await handleSyncJobError(admin, job, targetBinding.id, null, currentLink, err);

    logEvent("gcal_sync_job_error", {
      organization_id: job.organization_id,
      source_type: job.source_type,
      source_id: job.source_id,
      error_code: err instanceof Error ? err.message : "sync_failed",
      http_status: null,
    });
  }
}
