/**
 * Google Calendar push notifications (events.watch) and incremental sync (GCAL Prompt 12).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  GoogleCalendarApiError,
  listCalendarEventsPage,
  obtainAccessTokenForGoogleAccount,
  stopWatchChannel,
  watchCalendarEvents,
  type GoogleCalendarListEventItem,
} from "./googleCalendarClient.ts";
import { markJobDone, type OutboxJob } from "./calendarSyncCommon.ts";
import type { GoogleOAuthConfig } from "./googleOAuth.ts";
import { logEvent } from "./supabase.ts";
import { constantTimeEqual } from "./constantTime.ts";

export { constantTimeEqual };

const WATCH_TTL_MS = 6 * 24 * 60 * 60 * 1000;

export type WatchChannelRow = {
  id: string;
  binding_kind: "member" | "organization";
  member_binding_id: string | null;
  organization_binding_id: string | null;
  organization_id: string;
  calendar_id: string;
  google_account_id: string;
  channel_id: string;
  resource_id: string;
  channel_token: string;
  expiration: string;
  calendar_sync_token: string | null;
};

function webhookUrlOrNull(): string | null {
  const url = (Deno.env.get("GOOGLE_CALENDAR_WEBHOOK_URL") ?? "").trim();
  return url || null;
}

function randomChannelToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function bindingIdFromWatchRow(row: WatchChannelRow): string {
  return row.binding_kind === "member"
    ? (row.member_binding_id as string)
    : (row.organization_binding_id as string);
}

function isManagedTangodbEvent(event: GoogleCalendarListEventItem): boolean {
  return event.extendedProperties?.private?.managedBy === "tangodb";
}

async function detachLinkByGoogleEventId(
  admin: SupabaseClient,
  organizationId: string,
  bindingKind: "member" | "organization",
  bindingId: string,
  googleEventId: string
): Promise<boolean> {
  const nowIso = new Date().toISOString();
  let query = admin
    .from("google_calendar_event_links")
    .update({
      sync_status: "detached",
      detach_reason: "user_deleted",
      last_error: null,
      updated_at: nowIso,
    })
    .eq("organization_id", organizationId)
    .eq("google_event_id", googleEventId)
    .neq("sync_status", "detached");

  if (bindingKind === "member") {
    query = query.eq("member_binding_id", bindingId);
  } else {
    query = query.eq("organization_binding_id", bindingId);
  }

  const { data, error } = await query.select("id");
  if (error) {
    throw new Error(error.message);
  }
  return (data?.length ?? 0) > 0;
}

async function processChangedEvents(
  admin: SupabaseClient,
  watch: WatchChannelRow,
  events: GoogleCalendarListEventItem[]
): Promise<number> {
  const bindingId = bindingIdFromWatchRow(watch);
  let detached = 0;

  for (const event of events) {
    if (!event.id) continue;

    const { data: link } = await admin
      .from("google_calendar_event_links")
      .select("id, sync_status")
      .eq("organization_id", watch.organization_id)
      .eq("google_event_id", event.id)
      .maybeSingle();

    const isKnown = Boolean(link) || isManagedTangodbEvent(event);
    if (!isKnown) continue;

    if (event.status === "cancelled") {
      const didDetach = await detachLinkByGoogleEventId(
        admin,
        watch.organization_id,
        watch.binding_kind,
        bindingId,
        event.id
      );
      if (didDetach) detached += 1;
    }
  }

  return detached;
}

async function runIncrementalList(
  admin: SupabaseClient,
  config: GoogleOAuthConfig,
  watch: WatchChannelRow
): Promise<{ detached: number; pages: number }> {
  const accessToken = await obtainAccessTokenForGoogleAccount(
    admin,
    config,
    watch.google_account_id
  );

  let syncToken = watch.calendar_sync_token;
  let pageToken: string | null = null;
  let detached = 0;
  let pages = 0;
  let nextSyncToken: string | undefined;
  let fullSyncResets = 0;

  do {
    pages += 1;
    try {
      const page = await listCalendarEventsPage(accessToken, watch.calendar_id, {
        syncToken: pageToken ? null : syncToken,
        pageToken,
        showDeleted: true,
        privateExtendedProperty: syncToken || pageToken ? undefined : "managedBy=tangodb",
      });

      detached += await processChangedEvents(admin, watch, page.items);
      pageToken = page.nextPageToken ?? null;
      if (page.nextSyncToken) {
        nextSyncToken = page.nextSyncToken;
      }
    } catch (err) {
      if (
        err instanceof GoogleCalendarApiError &&
        (err.status === 410 || err.code === "fullSyncRequired")
      ) {
        if (fullSyncResets >= 1) {
          throw err;
        }
        fullSyncResets += 1;
        logEvent("gcal_incremental_sync_token_reset", {
          watch_id: watch.id,
          organization_id: watch.organization_id,
        });
        syncToken = null;
        pageToken = null;
        nextSyncToken = undefined;
        pages = 0;
        continue;
      }
      throw err;
    }
  } while (pageToken);

  if (nextSyncToken) {
    await admin
      .from("google_calendar_watch_channels")
      .update({
        calendar_sync_token: nextSyncToken,
        updated_at: new Date().toISOString(),
      })
      .eq("id", watch.id);
  }

  return { detached, pages };
}

export async function processIncrementalSyncJob(
  admin: SupabaseClient,
  config: GoogleOAuthConfig,
  job: OutboxJob
): Promise<void> {
  const bindingKind = job.source_type === "organization_binding" ? "organization" : "member";
  const bindingId = job.source_id;

  let watchQuery = admin.from("google_calendar_watch_channels").select("*");
  if (bindingKind === "member") {
    watchQuery = watchQuery.eq("member_binding_id", bindingId);
  } else {
    watchQuery = watchQuery.eq("organization_binding_id", bindingId);
  }

  const { data: watchRow, error: watchError } = await watchQuery.maybeSingle();
  if (watchError) {
    throw new Error(watchError.message);
  }
  if (!watchRow) {
    await markJobDone(admin, job.id);
    return;
  }

  const watch = watchRow as WatchChannelRow;
  const result = await runIncrementalList(admin, config, watch);

  logEvent("gcal_incremental_sync_complete", {
    organization_id: watch.organization_id,
    binding_kind: watch.binding_kind,
    binding_id: bindingId,
    detached_links: result.detached,
    pages: result.pages,
  });

  await markJobDone(admin, job.id);
}

async function stopExistingWatch(
  admin: SupabaseClient,
  config: GoogleOAuthConfig,
  watch: WatchChannelRow
): Promise<void> {
  try {
    const accessToken = await obtainAccessTokenForGoogleAccount(
      admin,
      config,
      watch.google_account_id
    );
    await stopWatchChannel(accessToken, {
      channelId: watch.channel_id,
      resourceId: watch.resource_id,
    });
  } catch (err) {
    logEvent("gcal_watch_stop_error", {
      watch_id: watch.id,
      message: err instanceof Error ? err.message : "unknown",
    });
  }

  await admin.from("google_calendar_watch_channels").delete().eq("id", watch.id);
}

export async function registerWatchForBinding(
  admin: SupabaseClient,
  config: GoogleOAuthConfig,
  params: {
    bindingKind: "member" | "organization";
    bindingId: string;
    organizationId: string;
    calendarId: string;
    googleAccountId: string;
  }
): Promise<void> {
  const webhookUrl = webhookUrlOrNull();
  if (!webhookUrl) {
    logEvent("gcal_watch_skipped", { reason: "webhook_url_not_configured" });
    return;
  }

  let existingQuery = admin.from("google_calendar_watch_channels").select("*");
  if (params.bindingKind === "member") {
    existingQuery = existingQuery.eq("member_binding_id", params.bindingId);
  } else {
    existingQuery = existingQuery.eq("organization_binding_id", params.bindingId);
  }

  const { data: existing } = await existingQuery.maybeSingle();
  if (existing) {
    await stopExistingWatch(admin, config, existing as WatchChannelRow);
  }

  const channelId = crypto.randomUUID();
  const channelToken = randomChannelToken();
  const accessToken = await obtainAccessTokenForGoogleAccount(
    admin,
    config,
    params.googleAccountId
  );

  const watchResponse = await watchCalendarEvents(accessToken, params.calendarId, {
    channelId,
    address: webhookUrl,
    token: channelToken,
    expirationMs: WATCH_TTL_MS,
  });

  const expirationIso = new Date(Number(watchResponse.expiration)).toISOString();
  const nowIso = new Date().toISOString();

  const insertRow: Record<string, unknown> = {
    binding_kind: params.bindingKind,
    organization_id: params.organizationId,
    calendar_id: params.calendarId,
    google_account_id: params.googleAccountId,
    channel_id: channelId,
    resource_id: watchResponse.resourceId,
    channel_token: channelToken,
    expiration: expirationIso,
    calendar_sync_token: null,
    updated_at: nowIso,
  };

  if (params.bindingKind === "member") {
    insertRow.member_binding_id = params.bindingId;
    insertRow.organization_binding_id = null;
  } else {
    insertRow.organization_binding_id = params.bindingId;
    insertRow.member_binding_id = null;
  }

  const { error } = await admin.from("google_calendar_watch_channels").insert(insertRow);
  if (error) {
    throw new Error(error.message);
  }

  logEvent("gcal_watch_registered", {
    organization_id: params.organizationId,
    binding_kind: params.bindingKind,
    binding_id: params.bindingId,
    expiration: expirationIso,
  });
}

export async function stopWatchForBinding(
  admin: SupabaseClient,
  config: GoogleOAuthConfig,
  bindingKind: "member" | "organization",
  bindingId: string
): Promise<void> {
  let query = admin.from("google_calendar_watch_channels").select("*");
  if (bindingKind === "member") {
    query = query.eq("member_binding_id", bindingId);
  } else {
    query = query.eq("organization_binding_id", bindingId);
  }

  const { data: watch } = await query.maybeSingle();
  if (!watch) return;

  await stopExistingWatch(admin, config, watch as WatchChannelRow);

  logEvent("gcal_watch_stopped", {
    binding_kind: bindingKind,
    binding_id: bindingId,
  });
}

export async function renewExpiringWatchChannels(
  admin: SupabaseClient,
  config: GoogleOAuthConfig
): Promise<{ renewed: number; failed: number; registered: number }> {
  const thresholdIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  let renewed = 0;
  let failed = 0;
  let registered = 0;

  const { data: expiring } = await admin
    .from("google_calendar_watch_channels")
    .select("*")
    .lte("expiration", thresholdIso);

  for (const row of (expiring ?? []) as WatchChannelRow[]) {
    const bindingId = bindingIdFromWatchRow(row);
    try {
      await stopExistingWatch(admin, config, row);
      await registerWatchForBinding(admin, config, {
        bindingKind: row.binding_kind,
        bindingId,
        organizationId: row.organization_id,
        calendarId: row.calendar_id,
        googleAccountId: row.google_account_id,
      });
      renewed += 1;
    } catch (err) {
      failed += 1;
      logEvent("gcal_watch_renew_error", {
        watch_id: row.id,
        binding_kind: row.binding_kind,
        binding_id: bindingId,
        message: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  const { data: memberBindings } = await admin
    .from("member_google_calendar_bindings")
    .select("id, organization_id, calendar_id, google_account_id")
    .eq("enabled", true);

  for (const binding of memberBindings ?? []) {
    const { data: existing } = await admin
      .from("google_calendar_watch_channels")
      .select("id")
      .eq("member_binding_id", binding.id)
      .maybeSingle();

    if (existing) continue;

    try {
      await registerWatchForBinding(admin, config, {
        bindingKind: "member",
        bindingId: binding.id as string,
        organizationId: binding.organization_id as string,
        calendarId: binding.calendar_id as string,
        googleAccountId: binding.google_account_id as string,
      });
      registered += 1;
    } catch (err) {
      failed += 1;
      logEvent("gcal_watch_backfill_error", {
        binding_kind: "member",
        binding_id: binding.id,
        message: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  const { data: orgBindings } = await admin
    .from("organization_google_calendar_bindings")
    .select("id, organization_id, calendar_id, google_account_id")
    .eq("enabled", true);

  for (const binding of orgBindings ?? []) {
    const { data: existing } = await admin
      .from("google_calendar_watch_channels")
      .select("id")
      .eq("organization_binding_id", binding.id)
      .maybeSingle();

    if (existing) continue;

    try {
      await registerWatchForBinding(admin, config, {
        bindingKind: "organization",
        bindingId: binding.id as string,
        organizationId: binding.organization_id as string,
        calendarId: binding.calendar_id as string,
        googleAccountId: binding.google_account_id as string,
      });
      registered += 1;
    } catch (err) {
      failed += 1;
      logEvent("gcal_watch_backfill_error", {
        binding_kind: "organization",
        binding_id: binding.id,
        message: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  return { renewed, failed, registered };
}

export async function lookupWatchChannel(
  admin: SupabaseClient,
  channelId: string
): Promise<WatchChannelRow | null> {
  const { data, error } = await admin
    .from("google_calendar_watch_channels")
    .select("*")
    .eq("channel_id", channelId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  return (data as WatchChannelRow | null) ?? null;
}
