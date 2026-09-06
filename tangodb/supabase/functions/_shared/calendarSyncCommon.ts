/**
 * Shared calendar-sync-worker infrastructure (personal + group occurrence).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { GoogleCalendarEventResource } from "./calendarSyncPayload.ts";
import {
  findOrCreateDedicatedCalendar,
  deleteCalendarEvent,
  getCalendarEvent,
  GoogleCalendarApiError,
  insertCalendarEvent,
  listCalendarEventsPage,
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
  operation: "upsert" | "delete" | "reconcile_member" | "refresh_member" | "incremental_sync";
  attempt_count: number;
};

export type EventLinkRow = {
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

export type MemberBindingRow = {
  id: string;
  organization_id: string;
  organization_member_id: string;
  google_account_id: string;
  calendar_id: string;
  calendar_name: string;
  enabled: boolean;
  sync_personal: boolean;
  sync_group: boolean;
  sync_events?: boolean;
  privacy_mode: string;
  cleanup_pending: boolean;
};

export type OrganizationBindingRow = {
  id: string;
  organization_id: string;
  google_account_id: string;
  calendar_id: string;
  calendar_name: string;
  enabled: boolean;
  cleanup_pending: boolean;
};

export type GoogleCalendarTarget = {
  google_account_id: string;
  calendar_id: string;
};

export type BindingContext = MemberBindingRow;

function computeRetryDelayMs(attemptCount: number): number {
  const base = 30_000;
  const max = 3_600_000;
  const exp = Math.min(base * 2 ** attemptCount, max);
  const jitter = Math.floor(Math.random() * 10_000);
  return exp + jitter;
}

export function siteUrl(): string {
  return (Deno.env.get("SITE_URL") ?? "https://tangodb.vercel.app").replace(/\/$/, "");
}

export function nestedName(
  value: { name: string } | { name: string }[] | null | undefined
): string | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0]?.name ?? null;
  return value.name ?? null;
}

export async function markJobDone(admin: SupabaseClient, jobId: string): Promise<void> {
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

export async function markJobRetry(
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

export async function loadOrgContext(
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

const MEMBER_BINDING_SELECT =
  "id, organization_id, organization_member_id, google_account_id, calendar_id, calendar_name, enabled, sync_personal, sync_group, sync_events, privacy_mode, cleanup_pending";

const ORG_BINDING_SELECT =
  "id, organization_id, google_account_id, calendar_id, calendar_name, enabled, cleanup_pending";

export async function loadActiveBinding(
  admin: SupabaseClient,
  organizationId: string,
  teacherMemberId: string,
  syncField: "sync_personal" | "sync_group"
): Promise<MemberBindingRow | null> {
  const { data } = await admin
    .from("member_google_calendar_bindings")
    .select(MEMBER_BINDING_SELECT)
    .eq("organization_id", organizationId)
    .eq("organization_member_id", teacherMemberId)
    .eq("enabled", true)
    .eq(syncField, true)
    .maybeSingle();

  return (data as MemberBindingRow | null) ?? null;
}

export async function recreateMemberBindingCalendar(
  admin: SupabaseClient,
  config: GoogleOAuthConfig,
  binding: MemberBindingRow
): Promise<MemberBindingRow | null> {
  const { data: account } = await admin
    .from("user_google_accounts")
    .select("granted_scopes")
    .eq("id", binding.google_account_id)
    .maybeSingle();
  const scopes = (account?.granted_scopes as string[] | null | undefined) ?? [];
  if (!scopes.includes("https://www.googleapis.com/auth/calendar.app.created")) {
    return null;
  }

  const repairCode = "calendar_auto_repairing";
  const nowIso = new Date().toISOString();
  const { data: claimed, error: claimError } = await admin
    .from("member_google_calendar_bindings")
    .update({
      last_error_code: repairCode,
      last_error_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", binding.id)
    .eq("calendar_id", binding.calendar_id)
    .or(`last_error_code.is.null,last_error_code.neq.${repairCode}`)
    .select("id")
    .maybeSingle();
  if (claimError) throw claimError;

  if (!claimed) {
    const latest = await loadBindingById(admin, binding.organization_id, binding.id);
    return latest?.calendar_id !== binding.calendar_id ? latest : null;
  }

  try {
    const accessToken = await obtainAccessTokenForGoogleAccount(
      admin,
      config,
      binding.google_account_id
    );
    const org = await loadOrgContext(admin, binding.organization_id);
    const dedicated = await findOrCreateDedicatedCalendar(
      accessToken,
      `TangoDB / ${org.organizationName}`,
      org.timezone,
      { alsoMatchPrefix: "TangoDB /", excludeSummaryIncludes: "/ rentals" }
    );
    const calendar = dedicated.calendar;

    if (calendar.id === binding.calendar_id) {
      const clearedAt = new Date().toISOString();
      await admin
        .from("member_google_calendar_bindings")
        .update({
          last_error_code: null,
          last_error_at: null,
          updated_at: clearedAt,
        })
        .eq("id", binding.id)
        .eq("last_error_code", repairCode);
      logEvent("gcal_calendar_repair_already_bound", {
        organization_id: binding.organization_id,
        binding_id: binding.id,
        calendar_id: binding.calendar_id,
      });
      return binding;
    }

    const repairedAt = new Date().toISOString();
    const { data: updated, error: updateError } = await admin
      .from("member_google_calendar_bindings")
      .update({
        calendar_id: calendar.id,
        calendar_name: calendar.summary,
        timezone: calendar.timeZone,
        last_error_code: null,
        last_error_at: null,
        updated_at: repairedAt,
      })
      .eq("id", binding.id)
      .eq("calendar_id", binding.calendar_id)
      .select(MEMBER_BINDING_SELECT)
      .maybeSingle();
    if (updateError || !updated) {
      throw updateError ?? new Error("calendar_binding_repair_update_failed");
    }
    logEvent(dedicated.reused ? "gcal_calendar_repair_reused" : "gcal_calendar_repair_created", {
      organization_id: binding.organization_id,
      binding_id: binding.id,
      calendar_id: calendar.id,
    });
    return updated as MemberBindingRow;
  } catch (err) {
    await admin
      .from("member_google_calendar_bindings")
      .update({
        last_error_code: "calendar_auto_repair_failed",
        last_error_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", binding.id)
      .eq("calendar_id", binding.calendar_id)
      .eq("last_error_code", repairCode);
    throw err;
  }
}

export async function loadActiveMemberEventsBinding(
  admin: SupabaseClient,
  organizationId: string,
  memberId: string
): Promise<MemberBindingRow | null> {
  const { data } = await admin
    .from("member_google_calendar_bindings")
    .select(MEMBER_BINDING_SELECT)
    .eq("organization_id", organizationId)
    .eq("organization_member_id", memberId)
    .eq("enabled", true)
    .eq("sync_events", true)
    .maybeSingle();

  return (data as MemberBindingRow | null) ?? null;
}

export async function loadActiveOrgBinding(
  admin: SupabaseClient,
  organizationId: string,
  purpose: "events" | "rentals" = "events"
): Promise<OrganizationBindingRow | null> {
  const { data } = await admin
    .from("organization_google_calendar_bindings")
    .select(ORG_BINDING_SELECT)
    .eq("organization_id", organizationId)
    .eq("enabled", true)
    .eq("purpose", purpose)
    .maybeSingle();

  return (data as OrganizationBindingRow | null) ?? null;
}

export async function loadBindingById(
  admin: SupabaseClient,
  organizationId: string,
  bindingId: string
): Promise<BindingContext | null> {
  const { data } = await admin
    .from("member_google_calendar_bindings")
    .select(MEMBER_BINDING_SELECT)
    .eq("organization_id", organizationId)
    .eq("id", bindingId)
    .maybeSingle();

  return (data as BindingContext | null) ?? null;
}

export async function loadOrgBindingById(
  admin: SupabaseClient,
  organizationId: string,
  bindingId: string
): Promise<OrganizationBindingRow | null> {
  const { data } = await admin
    .from("organization_google_calendar_bindings")
    .select(ORG_BINDING_SELECT)
    .eq("organization_id", organizationId)
    .eq("id", bindingId)
    .maybeSingle();

  return (data as OrganizationBindingRow | null) ?? null;
}

export async function isTeacherActive(
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

export async function loadLinksForSource(
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

export async function deleteLinkRow(admin: SupabaseClient, linkId: string): Promise<void> {
  await admin.from("google_calendar_event_links").delete().eq("id", linkId);
}

export async function maybeClearBindingCleanup(
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

export async function maybeClearOrgBindingCleanup(
  admin: SupabaseClient,
  organizationId: string,
  bindingId: string
): Promise<void> {
  const binding = await loadOrgBindingById(admin, organizationId, bindingId);
  if (!binding?.cleanup_pending) return;

  const { count } = await admin
    .from("google_calendar_event_links")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("organization_binding_id", bindingId);

  if ((count ?? 0) > 0) return;

  await admin
    .from("organization_google_calendar_bindings")
    .update({
      cleanup_pending: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", bindingId);
}

export async function deleteGoogleEventForLink(
  admin: SupabaseClient,
  config: GoogleOAuthConfig,
  link: EventLinkRow
): Promise<void> {
  if (!link.google_event_id) return;

  let target: GoogleCalendarTarget | null = null;

  if (link.member_binding_id) {
    const binding = await loadBindingById(admin, link.organization_id, link.member_binding_id);
    if (!binding) return;
    if (!binding.enabled && !binding.cleanup_pending) return;
    target = binding;
  } else if (link.organization_binding_id) {
    const binding = await loadOrgBindingById(
      admin,
      link.organization_id,
      link.organization_binding_id
    );
    if (!binding) return;
    if (!binding.enabled && !binding.cleanup_pending) return;
    target = binding;
  }

  if (!target) return;

  try {
    const accessToken = await obtainAccessTokenForGoogleAccount(
      admin,
      config,
      target.google_account_id
    );
    await deleteCalendarEvent(accessToken, target.calendar_id, link.google_event_id);
  } catch (err) {
    if (err instanceof GoogleCalendarApiError && (err.status === 404 || err.status === 410)) {
      return;
    }
    throw err;
  }
}

export async function removeStaleLinks(
  admin: SupabaseClient,
  config: GoogleOAuthConfig,
  links: EventLinkRow[],
  currentBindingId: string,
  currentOccurrenceDate: string
): Promise<void> {
  await removeStaleRecipientLinks(admin, config, links, {
    occurrenceDate: currentOccurrenceDate,
    memberBindingId: currentBindingId,
    organizationBindingId: null,
  });
}

function linkMatchesCurrentRecipient(
  link: EventLinkRow,
  current: {
    occurrenceDate: string;
    memberBindingId: string | null;
    organizationBindingId: string | null;
  }
): boolean {
  if (link.occurrence_date !== current.occurrenceDate) return false;

  if (link.member_binding_id != null) {
    return (
      current.memberBindingId != null &&
      link.member_binding_id === current.memberBindingId
    );
  }

  if (link.organization_binding_id != null) {
    return (
      current.organizationBindingId != null &&
      link.organization_binding_id === current.organizationBindingId
    );
  }

  return false;
}

/** Removes Google events/links that no longer match the current recipient(s). */
export async function removeStaleRecipientLinks(
  admin: SupabaseClient,
  config: GoogleOAuthConfig,
  links: EventLinkRow[],
  current: {
    occurrenceDate: string;
    memberBindingId: string | null;
    organizationBindingId: string | null;
  }
): Promise<void> {
  for (const link of links) {
    // Group slots have many occurrence dates — only reconcile recipient on this date.
    if (link.occurrence_date !== current.occurrenceDate) continue;
    if (linkMatchesCurrentRecipient(link, current)) continue;

    await deleteGoogleEventForLink(admin, config, link);
    await deleteLinkRow(admin, link.id);
    if (link.member_binding_id) {
      await maybeClearBindingCleanup(admin, link.organization_id, link.member_binding_id);
    }
    if (link.organization_binding_id) {
      await maybeClearOrgBindingCleanup(
        admin,
        link.organization_id,
        link.organization_binding_id
      );
    }
  }
}

export async function upsertLinkRow(
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

export async function upsertOrgLinkRow(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    organizationBindingId: string;
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
    .eq("organization_binding_id", input.organizationBindingId)
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
      recipient_kind: "organization",
      member_binding_id: null,
      organization_binding_id: input.organizationBindingId,
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

export async function recordBindingSuccess(
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

export async function recordOrgBindingSuccess(
  admin: SupabaseClient,
  bindingId: string
): Promise<void> {
  const nowIso = new Date().toISOString();
  await admin
    .from("organization_google_calendar_bindings")
    .update({
      last_success_at: nowIso,
      last_error_at: null,
      last_error_code: null,
      updated_at: nowIso,
    })
    .eq("id", bindingId);
}

export async function recordOrgBindingError(
  admin: SupabaseClient,
  bindingId: string,
  code: string
): Promise<void> {
  const nowIso = new Date().toISOString();
  await admin
    .from("organization_google_calendar_bindings")
    .update({
      last_error_at: nowIso,
      last_error_code: code,
      updated_at: nowIso,
    })
    .eq("id", bindingId);
}

export async function recordBindingError(
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

/** Deletes all TangoDB-managed events on a calendar (full resync / refresh). */
export async function purgeAllManagedEventsOnCalendar(
  accessToken: string,
  calendarId: string
): Promise<number> {
  let deleted = 0;
  let pageToken: string | null | undefined = undefined;

  while (true) {
    const page = await listCalendarEventsPage(accessToken, calendarId, {
      privateExtendedProperty: "managedBy=tangodb",
      pageToken,
      showDeleted: false,
    });

    for (const item of page.items) {
      if (item.status === "cancelled") continue;
      try {
        await deleteCalendarEvent(accessToken, calendarId, item.id);
        deleted += 1;
      } catch (err) {
        if (
          err instanceof GoogleCalendarApiError &&
          (err.status === 404 || err.status === 410)
        ) {
          continue;
        }
        throw err;
      }
    }

    if (!page.nextPageToken) break;
    pageToken = page.nextPageToken;
  }

  return deleted;
}

/** Deletes duplicate managed events on a calendar that share the same CRM source keys. */
export async function cleanupStaleManagedEvents(
  accessToken: string,
  calendarId: string,
  filters: {
    sourceType: string;
    sourceId: string;
    occurrenceKey?: string | null;
  },
  keepEventId: string
): Promise<void> {
  const privateExtendedProperties = [
    "managedBy=tangodb",
    `sourceType=${filters.sourceType}`,
    `sourceId=${filters.sourceId}`,
  ];
  if (filters.occurrenceKey) {
    privateExtendedProperties.push(`occurrenceKey=${filters.occurrenceKey}`);
  }

  let pageToken: string | null | undefined = undefined;
  while (true) {
    const page = await listCalendarEventsPage(accessToken, calendarId, {
      privateExtendedProperties,
      pageToken,
      showDeleted: false,
    });

    for (const item of page.items) {
      if (item.status === "cancelled") continue;
      if (item.id === keepEventId) continue;
      try {
        await deleteCalendarEvent(accessToken, calendarId, item.id);
      } catch (err) {
        if (
          err instanceof GoogleCalendarApiError &&
          (err.status === 404 || err.status === 410)
        ) {
          continue;
        }
        throw err;
      }
    }

    if (!page.nextPageToken) break;
    pageToken = page.nextPageToken;
  }
}

export async function syncEventToGoogle(
  admin: SupabaseClient,
  config: GoogleOAuthConfig,
  target: GoogleCalendarTarget,
  payload: GoogleCalendarEventResource,
  desiredHash: string,
  deterministicEventId: string,
  existingLink: EventLinkRow | null
): Promise<{ eventId: string; etag: string; accessToken: string; recoveredFromConflict: boolean }> {
  const accessToken = await obtainAccessTokenForGoogleAccount(
    admin,
    config,
    target.google_account_id
  );

  if (!existingLink?.google_event_id) {
    try {
      const created = await insertCalendarEvent(
        accessToken,
        target.calendar_id,
        payload,
        deterministicEventId
      );
      return {
        eventId: created.id,
        etag: created.etag,
        accessToken,
        recoveredFromConflict: false,
      };
    } catch (err) {
      if (err instanceof GoogleCalendarApiError && err.status === 409) {
        const existing = await getCalendarEvent(
          accessToken,
          target.calendar_id,
          deterministicEventId
        );
        const updated = await updateCalendarEvent(
          accessToken,
          target.calendar_id,
          existing.id,
          payload,
          existing.etag
        );
        return {
          eventId: updated.id,
          etag: updated.etag,
          accessToken,
          recoveredFromConflict: true,
        };
      }
      throw err;
    }
  }

  if (existingLink.desired_hash === desiredHash && existingLink.sync_status === "synced") {
    return {
      eventId: existingLink.google_event_id,
      etag: existingLink.google_etag ?? "",
      accessToken,
      recoveredFromConflict: false,
    };
  }

  if (existingLink.sync_status === "detached") {
    throw new GoogleCalendarApiError(409, "detached", "Event link is detached");
  }

  try {
    const updated = await updateCalendarEvent(
      accessToken,
      target.calendar_id,
      existingLink.google_event_id,
      payload,
      existingLink.google_etag
    );
    return {
      eventId: updated.id,
      etag: updated.etag,
      accessToken,
      recoveredFromConflict: false,
    };
  } catch (err) {
    if (!(err instanceof GoogleCalendarApiError)) throw err;

    if (err.status === 412) {
      const fresh = await getCalendarEvent(
        accessToken,
        target.calendar_id,
        existingLink.google_event_id
      );
      const updated = await updateCalendarEvent(
        accessToken,
        target.calendar_id,
        fresh.id,
        payload,
        fresh.etag
      );
      return {
        eventId: updated.id,
        etag: updated.etag,
        accessToken,
        recoveredFromConflict: false,
      };
    }

    if (err.status === 404) {
      const created = await insertCalendarEvent(
        accessToken,
        target.calendar_id,
        payload,
        deterministicEventId
      );
      return {
        eventId: created.id,
        etag: created.etag,
        accessToken,
        recoveredFromConflict: true,
      };
    }

    throw err;
  }
}

export async function handleSyncJobError(
  admin: SupabaseClient,
  job: OutboxJob,
  memberBindingId: string | null,
  orgBindingId: string | null,
  currentLink: EventLinkRow | null,
  err: unknown
): Promise<void> {
  const apiErr = err instanceof GoogleCalendarApiError ? err : null;
  const code = apiErr?.code ?? "sync_failed";
  const message = apiErr?.message ?? (err instanceof Error ? err.message : "unknown");

  if (apiErr?.status === 403) {
    if (memberBindingId) {
      await recordBindingError(admin, memberBindingId, code);
    }
    if (orgBindingId) {
      await recordOrgBindingError(admin, orgBindingId, code);
    }
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
  } else if (retryable || !apiErr) {
    await markJobRetry(admin, job, code, message);
  } else {
    await markJobRetry(admin, job, code, message);
  }
}

export async function loadOccurrenceConductingTeacherId(
  admin: SupabaseClient,
  organizationId: string,
  kind: "group" | "personal",
  scheduleSlotId: string | null,
  personalLessonId: string | null,
  occurrenceDate: string,
  fallback: string | null
): Promise<string | null> {
  let query = admin
    .from("lesson_occurrence_substitutes")
    .select("substitute_teacher_member_id")
    .eq("organization_id", organizationId)
    .eq("occurrence_kind", kind)
    .eq("occurrence_date", occurrenceDate)
    .limit(1);

  if (kind === "group") {
    if (!scheduleSlotId) return fallback;
    query = query.eq("schedule_slot_id", scheduleSlotId);
  } else {
    if (!personalLessonId) return fallback;
    query = query.eq("personal_lesson_id", personalLessonId);
  }

  const { data } = await query.maybeSingle();
  const substituteId = (data as { substitute_teacher_member_id?: string | null } | null)
    ?.substitute_teacher_member_id;
  return substituteId ?? fallback;
}

