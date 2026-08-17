/**
 * Google Calendar API client — list/create calendars, events CRUD, access token from stored credential.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { GoogleCalendarEventResource } from "./calendarSyncPayload.ts";
import {
  byteaToUint8Array,
  decryptRefreshToken,
  GoogleOAuthError,
  loadGoogleOAuthConfig,
  refreshGoogleAccessToken,
  type GoogleOAuthConfig,
} from "./googleOAuth.ts";
import { logEvent } from "./supabase.ts";

const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

export interface GoogleCalendarListEntry {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
  timeZone: string;
  selectable: boolean;
}

const FREEBUSY_ACCESS_ROLES = new Set(["freeBusyReader", "reader", "writer", "owner"]);

export function isFreebusyReadableAccessRole(accessRole: string): boolean {
  return FREEBUSY_ACCESS_ROLES.has(accessRole);
}

export interface GoogleCreatedCalendar {
  id: string;
  summary: string;
  timeZone: string;
}

export class GoogleCalendarApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "GoogleCalendarApiError";
  }
}

const WRITABLE_ACCESS_ROLES = new Set(["writer", "owner"]);

export function isWritableAccessRole(accessRole: string): boolean {
  return WRITABLE_ACCESS_ROLES.has(accessRole);
}

type GoogleAccountRow = {
  id: string;
  user_id: string;
  status: string;
  encrypted_refresh_token: unknown;
};

async function refreshAccessTokenForAccountRow(
  admin: SupabaseClient,
  config: GoogleOAuthConfig,
  googleAccountId: string,
  row: GoogleAccountRow
): Promise<string> {
  const tokenBytes = byteaToUint8Array(row.encrypted_refresh_token);
  if (!tokenBytes) {
    throw new GoogleCalendarApiError(401, "token_missing", "No stored credential for Google account");
  }

  let refreshToken: string;
  try {
    refreshToken = await decryptRefreshToken(config.encryptionKey, tokenBytes);
  } catch (err) {
    logEvent("gcal_decrypt_error", {
      google_account_id: googleAccountId,
      message: err instanceof Error ? err.message : "unknown",
    });
    throw new GoogleCalendarApiError(401, "token_decrypt_failed", "Failed to read stored credential");
  }

  try {
    const tokens = await refreshGoogleAccessToken(config, refreshToken);
    const nowIso = new Date().toISOString();
    await admin
      .from("user_google_accounts")
      .update({
        status: "active",
        last_verified_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", googleAccountId);

    return tokens.access_token;
  } catch (err) {
    if (err instanceof GoogleOAuthError) {
      if (err.code === "invalid_grant") {
        const nowIso = new Date().toISOString();
        await admin
          .from("user_google_accounts")
          .update({ status: "revoked", updated_at: nowIso })
          .eq("id", googleAccountId);
        throw new GoogleCalendarApiError(401, "token_revoked", "Google refresh token revoked");
      }
      throw new GoogleCalendarApiError(401, err.code, err.message);
    }
    throw err;
  }
}

export async function obtainAccessTokenForAccount(
  admin: SupabaseClient,
  config: GoogleOAuthConfig,
  googleAccountId: string,
  userId: string
): Promise<string> {
  const { data: account, error } = await admin
    .from("user_google_accounts")
    .select("id, user_id, status, encrypted_refresh_token")
    .eq("id", googleAccountId)
    .maybeSingle();

  if (error || !account) {
    throw new GoogleCalendarApiError(404, "google_account_not_found", "Google account not found");
  }

  const row = account as GoogleAccountRow;
  if (row.user_id !== userId) {
    throw new GoogleCalendarApiError(403, "forbidden", "Google account does not belong to user");
  }

  return refreshAccessTokenForAccountRow(admin, config, googleAccountId, row);
}

/** Service-role worker path — no end-user ownership check. */
export async function obtainAccessTokenForGoogleAccount(
  admin: SupabaseClient,
  config: GoogleOAuthConfig,
  googleAccountId: string
): Promise<string> {
  const { data: account, error } = await admin
    .from("user_google_accounts")
    .select("id, user_id, status, encrypted_refresh_token")
    .eq("id", googleAccountId)
    .maybeSingle();

  if (error || !account) {
    throw new GoogleCalendarApiError(404, "google_account_not_found", "Google account not found");
  }

  return refreshAccessTokenForAccountRow(
    admin,
    config,
    googleAccountId,
    account as GoogleAccountRow
  );
}

async function parseGoogleApiError(res: Response): Promise<GoogleCalendarApiError> {
  let code = "google_api_error";
  let message = `HTTP ${res.status}`;
  try {
    const payload = await res.json() as { error?: { code?: number; message?: string; status?: string } };
    const err = payload.error;
    if (err?.status) code = err.status;
    if (err?.message) message = err.message;
  } catch {
    // ignore JSON parse failure
  }
  return new GoogleCalendarApiError(res.status, code, message);
}

export async function listGoogleCalendars(
  accessToken: string,
  options?: { forFreebusy?: boolean }
): Promise<GoogleCalendarListEntry[]> {
  const minAccessRole = options?.forFreebusy ? "freeBusyReader" : "reader";
  const res = await fetch(
    `${CALENDAR_API_BASE}/users/me/calendarList?minAccessRole=${minAccessRole}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!res.ok) {
    throw await parseGoogleApiError(res);
  }

  const payload = await res.json() as {
    items?: Array<{
      id?: string;
      summary?: string;
      primary?: boolean;
      accessRole?: string;
      timeZone?: string;
    }>;
  };

  const items = payload.items ?? [];
  return items
    .filter((item) => typeof item.id === "string" && item.id.length > 0)
    .map((item) => {
      const accessRole = String(item.accessRole ?? "");
      const freebusyReadable = isFreebusyReadableAccessRole(accessRole);
      return {
        id: item.id as string,
        summary: String(item.summary ?? item.id),
        primary: item.primary === true,
        accessRole,
        timeZone: String(item.timeZone ?? "UTC"),
        selectable: options?.forFreebusy ? freebusyReadable : isWritableAccessRole(accessRole),
      };
    });
}

export async function createGoogleCalendar(
  accessToken: string,
  summary: string,
  timeZone: string
): Promise<GoogleCreatedCalendar> {
  const res = await fetch(`${CALENDAR_API_BASE}/calendars`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ summary, timeZone }),
  });

  if (!res.ok) {
    throw await parseGoogleApiError(res);
  }

  const payload = await res.json() as { id?: string; summary?: string; timeZone?: string };
  if (!payload.id) {
    throw new GoogleCalendarApiError(500, "create_failed", "Google did not return calendar id");
  }

  return {
    id: payload.id,
    summary: String(payload.summary ?? summary),
    timeZone: String(payload.timeZone ?? timeZone),
  };
}

export function mapCalendarApiError(err: unknown): { status: number; body: Record<string, unknown> } {
  if (err instanceof GoogleCalendarApiError) {
    const clientCode =
      err.code === "token_revoked" || err.code === "token_missing" || err.code === "token_decrypt_failed"
        ? "token_revoked"
        : err.status === 403 || err.code === "PERMISSION_DENIED" || err.code === "forbidden"
          ? "calendar_access_denied"
          : err.status === 401
            ? "token_error"
            : "google_api_error";

    return {
      status: err.status === 404 ? 404 : err.status >= 400 && err.status < 600 ? err.status : 500,
      body: { error: clientCode, code: err.code, message: err.message },
    };
  }

  if (err instanceof GoogleOAuthError) {
    return {
      status: 401,
      body: { error: "token_error", code: err.code, message: err.message },
    };
  }

  return {
    status: 500,
    body: { error: "internal_error", message: err instanceof Error ? err.message : "unknown" },
  };
}

export async function loadGoogleOAuthConfigOrThrow(): Promise<GoogleOAuthConfig> {
  const config = await loadGoogleOAuthConfig();
  if (!config) {
    throw new GoogleCalendarApiError(503, "service_unavailable", "Google OAuth not configured");
  }
  return config;
}

export type GoogleCalendarEventResponse = {
  id: string;
  etag: string;
};

function parseEventResponse(payload: Record<string, unknown>): GoogleCalendarEventResponse {
  const id = typeof payload.id === "string" ? payload.id : "";
  const etag = typeof payload.etag === "string" ? payload.etag : "";
  if (!id) {
    throw new GoogleCalendarApiError(500, "event_missing_id", "Google event response missing id");
  }
  return { id, etag };
}

export async function getCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventId: string
): Promise<GoogleCalendarEventResponse> {
  const res = await fetch(
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!res.ok) {
    throw await parseGoogleApiError(res);
  }

  const payload = await res.json() as Record<string, unknown>;
  return parseEventResponse(payload);
}

export async function insertCalendarEvent(
  accessToken: string,
  calendarId: string,
  payload: GoogleCalendarEventResource,
  eventId?: string
): Promise<GoogleCalendarEventResponse> {
  const query = eventId ? `?eventId=${encodeURIComponent(eventId)}` : "";
  const res = await fetch(
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events${query}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    throw await parseGoogleApiError(res);
  }

  const body = await res.json() as Record<string, unknown>;
  return parseEventResponse(body);
}

export async function updateCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  payload: GoogleCalendarEventResource,
  etag?: string | null
): Promise<GoogleCalendarEventResponse> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
  if (etag) {
    headers["If-Match"] = etag;
  }

  const res = await fetch(
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "PUT",
      headers,
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    throw await parseGoogleApiError(res);
  }

  const body = await res.json() as Record<string, unknown>;
  return parseEventResponse(body);
}

export async function deleteCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventId: string
): Promise<void> {
  const res = await fetch(
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (res.status === 404 || res.status === 410) {
    return;
  }

  if (!res.ok) {
    throw await parseGoogleApiError(res);
  }
}

export type GoogleCalendarListEventItem = {
  id: string;
  status: string;
  extendedProperties?: { private?: Record<string, string> };
};

export type GoogleCalendarEventsListPage = {
  items: GoogleCalendarListEventItem[];
  nextSyncToken?: string;
  nextPageToken?: string;
};

export async function listCalendarEventsPage(
  accessToken: string,
  calendarId: string,
  params: {
    syncToken?: string | null;
    pageToken?: string | null;
    showDeleted?: boolean;
    privateExtendedProperty?: string;
    privateExtendedProperties?: string[];
  }
): Promise<GoogleCalendarEventsListPage> {
  const query = new URLSearchParams();
  query.set("maxResults", "250");
  query.set("singleEvents", "true");

  if (params.syncToken) {
    query.set("syncToken", params.syncToken);
  }
  if (params.pageToken) {
    query.set("pageToken", params.pageToken);
  }
  if (params.showDeleted !== false) {
    query.set("showDeleted", "true");
  }
  if (params.privateExtendedProperty) {
    query.append("privateExtendedProperty", params.privateExtendedProperty);
  }
  if (params.privateExtendedProperties) {
    for (const prop of params.privateExtendedProperties) {
      query.append("privateExtendedProperty", prop);
    }
  }

  const res = await fetch(
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${query.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!res.ok) {
    throw await parseGoogleApiError(res);
  }

  const body = await res.json() as {
    items?: GoogleCalendarListEventItem[];
    nextSyncToken?: string;
    nextPageToken?: string;
  };

  return {
    items: body.items ?? [],
    nextSyncToken: body.nextSyncToken,
    nextPageToken: body.nextPageToken,
  };
}

export type GoogleWatchChannelResponse = {
  resourceId: string;
  expiration: string;
};

export async function watchCalendarEvents(
  accessToken: string,
  calendarId: string,
  params: {
    channelId: string;
    address: string;
    token: string;
    expirationMs?: number;
  }
): Promise<GoogleWatchChannelResponse> {
  const expirationMs = params.expirationMs ?? 6 * 24 * 60 * 60 * 1000;
  const res = await fetch(
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/watch`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: params.channelId,
        type: "web_hook",
        address: params.address,
        token: params.token,
        expiration: String(Date.now() + expirationMs),
      }),
    }
  );

  if (!res.ok) {
    throw await parseGoogleApiError(res);
  }

  const body = await res.json() as { resourceId?: string; expiration?: string };
  if (!body.resourceId) {
    throw new GoogleCalendarApiError(500, "watch_missing_resource_id", "Watch response missing resourceId");
  }

  return {
    resourceId: body.resourceId,
    expiration: body.expiration ?? String(Date.now() + expirationMs),
  };
}

export async function stopWatchChannel(
  accessToken: string,
  params: { channelId: string; resourceId: string }
): Promise<void> {
  const res = await fetch(`${CALENDAR_API_BASE}/channels/stop`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: params.channelId,
      resourceId: params.resourceId,
    }),
  });

  if (res.status === 404) {
    return;
  }

  if (!res.ok) {
    throw await parseGoogleApiError(res);
  }
}

export type GoogleFreebusyInterval = {
  start: string;
  end: string;
};

export async function queryCalendarFreebusy(
  accessToken: string,
  params: {
    calendarIds: string[];
    timeMin: string;
    timeMax: string;
    timeZone: string;
  }
): Promise<GoogleFreebusyInterval[]> {
  if (!params.calendarIds.length) {
    return [];
  }

  const res = await fetch(`${CALENDAR_API_BASE}/freeBusy`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin: params.timeMin,
      timeMax: params.timeMax,
      timeZone: params.timeZone,
      items: params.calendarIds.map((id) => ({ id })),
    }),
  });

  if (!res.ok) {
    throw await parseGoogleApiError(res);
  }

  const payload = await res.json() as {
    calendars?: Record<string, { busy?: Array<{ start?: string; end?: string }> }>;
  };

  const merged: GoogleFreebusyInterval[] = [];
  for (const cal of Object.values(payload.calendars ?? {})) {
    for (const slot of cal.busy ?? []) {
      if (typeof slot.start === "string" && typeof slot.end === "string") {
        merged.push({ start: slot.start, end: slot.end });
      }
    }
  }

  merged.sort((a, b) => a.start.localeCompare(b.start));
  return merged;
}
