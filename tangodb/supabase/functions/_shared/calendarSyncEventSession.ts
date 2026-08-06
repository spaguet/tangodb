/**
 * Event session sync logic for calendar-sync-worker (GCAL Prompt 11).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildEventSessionGoogleEvent,
  googleEventIdFromUuid,
  hashGoogleEventPayload,
} from "./calendarSyncPayload.ts";
import {
  type OutboxJob,
  siteUrl,
  nestedName,
  markJobDone,
  loadOrgContext,
  loadActiveOrgBinding,
  loadActiveMemberEventsBinding,
  isTeacherActive,
  loadLinksForSource,
  deleteGoogleEventForLink,
  deleteLinkRow,
  maybeClearBindingCleanup,
  maybeClearOrgBindingCleanup,
  upsertLinkRow,
  upsertOrgLinkRow,
  recordBindingSuccess,
  recordOrgBindingSuccess,
  syncEventToGoogle,
  handleSyncJobError,
  type EventLinkRow,
  type MemberBindingRow,
  type OrganizationBindingRow,
} from "./calendarSyncCommon.ts";
import type { GoogleOAuthConfig } from "./googleOAuth.ts";
import { logEvent } from "./supabase.ts";

type EventSessionRow = {
  id: string;
  organization_id: string;
  event_id: string;
  session_date: string;
  time_start: string;
  time_end: string;
  location_id: string;
  locations: { name: string } | { name: string }[] | null;
  calendar_events:
    | {
        title: string;
        event_type: string;
        guest_teacher: string | null;
        organizer: string | null;
        comment: string | null;
        created_by: string | null;
      }
    | {
        title: string;
        event_type: string;
        guest_teacher: string | null;
        organizer: string | null;
        comment: string | null;
        created_by: string | null;
      }[]
    | null;
};

function nestedEvent(
  value: EventSessionRow["calendar_events"]
): {
  title: string;
  event_type: string;
  guest_teacher: string | null;
  organizer: string | null;
  comment: string | null;
  created_by: string | null;
} | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

async function loadEventSession(
  admin: SupabaseClient,
  organizationId: string,
  sessionId: string
): Promise<EventSessionRow | null> {
  const { data } = await admin
    .from("calendar_event_sessions")
    .select(
      "id, organization_id, event_id, session_date, time_start, time_end, location_id, locations(name), calendar_events(title, event_type, guest_teacher, organizer, comment, created_by)"
    )
    .eq("organization_id", organizationId)
    .eq("id", sessionId)
    .maybeSingle();

  return (data as EventSessionRow | null) ?? null;
}

async function buildSessionPayload(admin: SupabaseClient, session: EventSessionRow) {
  const orgContext = await loadOrgContext(admin, session.organization_id);
  const event = nestedEvent(session.calendar_events);
  if (!event) {
    throw new Error("event_session_parent_missing");
  }

  return buildEventSessionGoogleEvent({
    sessionId: session.id,
    organizationId: session.organization_id,
    sessionDate: session.session_date,
    timeStart: session.time_start,
    timeEnd: session.time_end,
    timeZone: orgContext.timezone,
    title: event.title,
    eventType: event.event_type,
    guestTeacher: event.guest_teacher,
    organizer: event.organizer,
    comment: event.comment,
    locationName: nestedName(session.locations),
    organizationName: orgContext.organizationName,
    scheduleUrl: `${siteUrl()}/schedule`,
  });
}

function findLink(
  links: EventLinkRow[],
  recipientKind: "organization" | "member",
  bindingId: string,
  occurrenceDate: string
): EventLinkRow | null {
  return (
    links.find(
      (link) =>
        link.recipient_kind === recipientKind &&
        link.occurrence_date === occurrenceDate &&
        link.sync_status !== "detached" &&
        (recipientKind === "organization"
          ? link.organization_binding_id === bindingId
          : link.member_binding_id === bindingId)
    ) ?? null
  );
}

function hasDetachedLink(
  links: EventLinkRow[],
  recipientKind: "organization" | "member",
  bindingId: string,
  occurrenceDate: string
): boolean {
  return links.some(
    (link) =>
      link.recipient_kind === recipientKind &&
      link.occurrence_date === occurrenceDate &&
      link.sync_status === "detached" &&
      (recipientKind === "organization"
        ? link.organization_binding_id === bindingId
        : link.member_binding_id === bindingId)
  );
}

async function syncToBinding(
  admin: SupabaseClient,
  config: GoogleOAuthConfig,
  session: EventSessionRow,
  recipientKind: "organization" | "member",
  binding: OrganizationBindingRow | MemberBindingRow,
  allLinks: EventLinkRow[],
  occurrenceDate: string
): Promise<{ ok: true } | { ok: false; err: unknown; currentLink: EventLinkRow | null; bindingId: string }> {
  const bindingId = binding.id;
  const payload = await buildSessionPayload(admin, session);
  const desiredHash = await hashGoogleEventPayload(payload);
  const deterministicEventId = googleEventIdFromUuid(session.id);

  const currentLink = findLink(allLinks, recipientKind, bindingId, occurrenceDate);

  if (hasDetachedLink(allLinks, recipientKind, bindingId, occurrenceDate)) {
    return { ok: true };
  }

  if (currentLink?.desired_hash === desiredHash && currentLink.sync_status === "synced") {
    return { ok: true };
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

    if (recipientKind === "organization") {
      await upsertOrgLinkRow(admin, {
        organizationId: session.organization_id,
        organizationBindingId: bindingId,
        sourceType: "event_session",
        sourceId: session.id,
        occurrenceDate,
        googleEventId: eventId,
        googleEtag: etag,
        desiredHash,
      });
      await recordOrgBindingSuccess(admin, bindingId);
    } else {
      await upsertLinkRow(admin, {
        organizationId: session.organization_id,
        memberBindingId: bindingId,
        sourceType: "event_session",
        sourceId: session.id,
        occurrenceDate,
        googleEventId: eventId,
        googleEtag: etag,
        desiredHash,
      });
      await recordBindingSuccess(admin, bindingId);
    }

    logEvent("gcal_sync_upsert_done", {
      organization_id: session.organization_id,
      source_type: "event_session",
      source_id: session.id,
      occurrence_date: occurrenceDate,
      recipient_kind: recipientKind,
      link_status: "synced",
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      err,
      currentLink,
      bindingId,
    };
  }
}

export async function deleteEventSession(
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
    "event_session",
    job.source_id
  )).filter((link) => link.occurrence_date === job.occurrence_date);

  for (const link of links) {
    await deleteGoogleEventForLink(admin, config, link);
    await deleteLinkRow(admin, link.id);
    if (link.member_binding_id) {
      await maybeClearBindingCleanup(admin, job.organization_id, link.member_binding_id);
    }
    if (link.organization_binding_id) {
      await maybeClearOrgBindingCleanup(
        admin,
        job.organization_id,
        link.organization_binding_id
      );
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

export async function upsertEventSession(
  admin: SupabaseClient,
  config: GoogleOAuthConfig,
  job: OutboxJob
): Promise<void> {
  if (!job.occurrence_date) {
    await markJobDone(admin, job.id);
    return;
  }

  const occurrenceDate = job.occurrence_date;
  const session = await loadEventSession(admin, job.organization_id, job.source_id);

  if (!session) {
    await deleteEventSession(admin, config, job);
    return;
  }

  const allLinks = await loadLinksForSource(
    admin,
    job.organization_id,
    "event_session",
    session.id
  );

  const orgBinding = await loadActiveOrgBinding(admin, job.organization_id);
  let firstFailure:
    | {
        err: unknown;
        memberBindingId: string | null;
        orgBindingId: string | null;
        currentLink: EventLinkRow | null;
      }
    | null = null;

  if (orgBinding) {
    const result = await syncToBinding(
      admin,
      config,
      session,
      "organization",
      orgBinding,
      allLinks,
      occurrenceDate
    );
    if (!result.ok) {
      firstFailure = {
        err: result.err,
        memberBindingId: null,
        orgBindingId: result.bindingId,
        currentLink: result.currentLink,
      };
    }
  }

  const event = nestedEvent(session.calendar_events);
  if (event?.created_by && !firstFailure) {
    const creatorActive = await isTeacherActive(
      admin,
      job.organization_id,
      event.created_by
    );
    if (creatorActive) {
      const memberBinding = await loadActiveMemberEventsBinding(
        admin,
        job.organization_id,
        event.created_by
      );
      if (memberBinding) {
        const result = await syncToBinding(
          admin,
          config,
          session,
          "member",
          memberBinding,
          allLinks,
          occurrenceDate
        );
        if (!result.ok) {
          firstFailure = {
            err: result.err,
            memberBindingId: result.bindingId,
            orgBindingId: null,
            currentLink: result.currentLink,
          };
        }
      }
    }
  }

  if (firstFailure) {
    await handleSyncJobError(
      admin,
      job,
      firstFailure.memberBindingId,
      firstFailure.orgBindingId,
      firstFailure.currentLink,
      firstFailure.err
    );
    logEvent("gcal_sync_job_error", {
      organization_id: job.organization_id,
      source_type: job.source_type,
      source_id: job.source_id,
      error_code:
        firstFailure.err instanceof Error ? firstFailure.err.message : "sync_failed",
      http_status: null,
    });
    return;
  }

  await markJobDone(admin, job.id);
}
