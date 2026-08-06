/**
 * Shared calendar-sync-worker infrastructure (personal + group occurrence).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { GoogleCalendarEventResource } from "./calendarSyncPayload.ts";
import {
  deleteCalendarEvent,
  getCalendarEvent,
  GoogleCalendarApiError,
  insertCalendarEvent,
  obtainAccessTokenForGoogleAccount,
  updateCalendarEvent,
} from "./googleCalendarClient.ts";
import type { GoogleOAuthConfig } from "./googleOAuth.ts";

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
  privacy_mode: string;
  cleanup_pending: boolean;
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

const BINDING_SELECT =
  "id, organization_id, organization_member_id, google_account_id, calendar_id, calendar_name, enabled, sync_personal, sync_group, privacy_mode, cleanup_pending";

export async function loadActiveBinding(
  admin: SupabaseClient,
  organizationId: string,
  teacherMemberId: string,
  syncField: "sync_personal" | "sync_group"
): Promise<MemberBindingRow | null> {
  const { data } = await admin
    .from("member_google_calendar_bindings")
    .select(BINDING_SELECT)
    .eq("organization_id", organizationId)
    .eq("organization_member_id", teacherMemberId)
    .eq("enabled", true)
    .eq(syncField, true)
    .maybeSingle();

  return (data as MemberBindingRow | null) ?? null;
}

export async function loadBindingById(
  admin: SupabaseClient,
  organizationId: string,
  bindingId: string
): Promise<BindingContext | null> {
  const { data } = await admin
    .from("member_google_calendar_bindings")
    .select(BINDING_SELECT)
    .eq("organization_id", organizationId)
    .eq("id", bindingId)
    .maybeSingle();

  return (data as BindingContext | null) ?? null;
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

export async function deleteGoogleEventForLink(
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

export async function removeStaleLinks(
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

export async function syncEventToGoogle(
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

export async function handleSyncJobError(
  admin: SupabaseClient,
  job: OutboxJob,
  bindingId: string | null,
  currentLink: EventLinkRow | null,
  err: unknown
): Promise<void> {
  const apiErr = err instanceof GoogleCalendarApiError ? err : null;
  const code = apiErr?.code ?? "sync_failed";
  const message = apiErr?.message ?? (err instanceof Error ? err.message : "unknown");

  if (apiErr?.status === 403 && bindingId) {
    await recordBindingError(admin, bindingId, code);
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
