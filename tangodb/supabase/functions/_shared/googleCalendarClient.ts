/**
 * Google Calendar API client — list/create calendars, events CRUD, access token from stored credential.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { GoogleCalendarEventResource } from "./calendarSyncPayload.ts";
import {
  byteaToUint8Array,
  decryptRefreshToken,
  encryptRefreshToken,
  GoogleOAuthError,
  loadGoogleOAuthConfig,
  refreshGoogleAccessToken,
  uint8ArrayToByteaHex,
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
  encrypted_access_token?: unknown;
  access_token_expires_at?: string | null;
};

const ACCESS_TOKEN_SKEW_MS = 120_000;
const GOOGLE_ACCOUNT_TOKEN_SELECT =
  "id, user_id, status, encrypted_refresh_token, encrypted_access_token, access_token_expires_at";

const accessTokenMemory = new Map<string, { token: string; expiresAtMs: number }>();
const accessTokenInflight = new Map<string, Promise<string>>();

function cachedAccessToken(googleAccountId: string): string | null {
  const entry = accessTokenMemory.get(googleAccountId);
  if (!entry) return null;
  if (entry.expiresAtMs <= Date.now() + 15_000) {
    accessTokenMemory.delete(googleAccountId);
    return null;
  }
  return entry.token;
}

function rememberAccessToken(
  googleAccountId: string,
  token: string,
  expiresAtMs: number
): void {
  accessTokenMemory.set(googleAccountId, { token, expiresAtMs });
}

function accessTokenStillValid(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  const expiresAtMs = Date.parse(expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs > Date.now() + 15_000;
}

async function decryptStoredAccessToken(
  config: GoogleOAuthConfig,
  encrypted: unknown
): Promise<string | null> {
  const bytes = byteaToUint8Array(encrypted);
  if (!bytes) return null;
  try {
    return await decryptRefreshToken(config.encryptionKey, bytes);
  } catch {
    return null;
  }
}

async function loadGoogleAccountRow(
  admin: SupabaseClient,
  googleAccountId: string
): Promise<GoogleAccountRow> {
  const { data: account, error } = await admin
    .from("user_google_accounts")
    .select(GOOGLE_ACCOUNT_TOKEN_SELECT)
    .eq("id", googleAccountId)
    .maybeSingle();

  if (error || !account) {
    throw new GoogleCalendarApiError(404, "google_account_not_found", "Google account not found");
  }

  return account as GoogleAccountRow;
}

async function persistAccessToken(
  admin: SupabaseClient,
  config: GoogleOAuthConfig,
  googleAccountId: string,
  accessToken: string,
  expiresInSec: number,
  rotatedRefreshToken?: string
): Promise<number> {
  const nowIso = new Date().toISOString();
  const expiresAtMs = Date.now() + Math.max(expiresInSec * 1000 - ACCESS_TOKEN_SKEW_MS, 30_000);
  const encryptedAccess = await encryptRefreshToken(config.encryptionKey, accessToken);
  const patch: Record<string, unknown> = {
    status: "active",
    last_verified_at: nowIso,
    updated_at: nowIso,
    encrypted_access_token: uint8ArrayToByteaHex(encryptedAccess),
    access_token_expires_at: new Date(expiresAtMs).toISOString(),
  };
  if (rotatedRefreshToken) {
    const encryptedRefresh = await encryptRefreshToken(
      config.encryptionKey,
      rotatedRefreshToken
    );
    patch.encrypted_refresh_token = uint8ArrayToByteaHex(encryptedRefresh);
    patch.refresh_token_issued_at = nowIso;
  }

  await admin.from("user_google_accounts").update(patch).eq("id", googleAccountId);
  rememberAccessToken(googleAccountId, accessToken, expiresAtMs);
  return expiresAtMs;
}

async function refreshAccessTokenForAccountRow(
  admin: SupabaseClient,
  config: GoogleOAuthConfig,
  googleAccountId: string,
  row: GoogleAccountRow
): Promise<string> {
  const memoryHit = cachedAccessToken(googleAccountId);
  if (memoryHit) return memoryHit;

  if (
    accessTokenStillValid(row.access_token_expires_at) &&
    row.encrypted_access_token
  ) {
    const cached = await decryptStoredAccessToken(config, row.encrypted_access_token);
    if (cached) {
      rememberAccessToken(
        googleAccountId,
        cached,
        Date.parse(row.access_token_expires_at as string)
      );
      return cached;
    }
  }

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
    await persistAccessToken(
      admin,
      config,
      googleAccountId,
      tokens.access_token,
      tokens.expires_in ?? 3600,
      tokens.refresh_token
    );
    return tokens.access_token;
  } catch (err) {
    if (err instanceof GoogleOAuthError && err.code === "invalid_grant") {
      const latest = await loadGoogleAccountRow(admin, googleAccountId);
      if (
        accessTokenStillValid(latest.access_token_expires_at) &&
        latest.encrypted_access_token
      ) {
        const cached = await decryptStoredAccessToken(config, latest.encrypted_access_token);
        if (cached) {
          rememberAccessToken(
            googleAccountId,
            cached,
            Date.parse(latest.access_token_expires_at as string)
          );
          return cached;
        }
      }

      const latestRefreshBytes = byteaToUint8Array(latest.encrypted_refresh_token);
      const latestRefresh = latestRefreshBytes
        ? await decryptRefreshToken(config.encryptionKey, latestRefreshBytes).catch(() => null)
        : null;
      if (latestRefresh && latestRefresh !== refreshToken) {
        try {
          const retried = await refreshGoogleAccessToken(config, latestRefresh);
          await persistAccessToken(
            admin,
            config,
            googleAccountId,
            retried.access_token,
            retried.expires_in ?? 3600,
            retried.refresh_token
          );
          return retried.access_token;
        } catch {
          // fall through to revoke
        }
      }

      const nowIso = new Date().toISOString();
      accessTokenMemory.delete(googleAccountId);
      await admin
        .from("user_google_accounts")
        .update({
          status: "revoked",
          encrypted_access_token: null,
          access_token_expires_at: null,
          updated_at: nowIso,
        })
        .eq("id", googleAccountId);
      throw new GoogleCalendarApiError(401, "token_revoked", "Google refresh token revoked");
    }
    if (err instanceof GoogleOAuthError) {
      throw new GoogleCalendarApiError(401, err.code, err.message);
    }
    throw err;
  }
}

async function obtainAccessTokenCached(
  admin: SupabaseClient,
  config: GoogleOAuthConfig,
  googleAccountId: string,
  row: GoogleAccountRow
): Promise<string> {
  const memoryHit = cachedAccessToken(googleAccountId);
  if (memoryHit) return memoryHit;

  const inflight = accessTokenInflight.get(googleAccountId);
  if (inflight) return inflight;

  const pending = refreshAccessTokenForAccountRow(admin, config, googleAccountId, row)
    .finally(() => {
      accessTokenInflight.delete(googleAccountId);
    });
  accessTokenInflight.set(googleAccountId, pending);
  return pending;
}

export async function obtainAccessTokenForAccount(
  admin: SupabaseClient,
  config: GoogleOAuthConfig,
  googleAccountId: string,
  userId: string
): Promise<string> {
  const row = await loadGoogleAccountRow(admin, googleAccountId);
  if (row.user_id !== userId) {
    throw new GoogleCalendarApiError(403, "forbidden", "Google account does not belong to user");
  }

  return obtainAccessTokenCached(admin, config, googleAccountId, row);
}

/** Service-role worker path — no end-user ownership check. */
export async function obtainAccessTokenForGoogleAccount(
  admin: SupabaseClient,
  config: GoogleOAuthConfig,
  googleAccountId: string
): Promise<string> {
  const row = await loadGoogleAccountRow(admin, googleAccountId);
  return obtainAccessTokenCached(admin, config, googleAccountId, row);
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
  options?: { forFreebusy?: boolean; restrictToAppCreated?: boolean }
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
      const primary = item.primary === true;
      const writable = isWritableAccessRole(accessRole);
      const selectable = options?.forFreebusy
        ? freebusyReadable
        : options?.restrictToAppCreated
          ? writable && !primary
          : writable;
      return {
        id: item.id as string,
        summary: String(item.summary ?? item.id),
        primary,
        accessRole,
        timeZone: String(item.timeZone ?? "UTC"),
        selectable,
      };
    });
}

export async function getGoogleCalendar(
  accessToken: string,
  calendarId: string
): Promise<GoogleCreatedCalendar | null> {
  const res = await fetch(
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (res.status === 404) return null;
  if (!res.ok) {
    throw await parseGoogleApiError(res);
  }

  const payload = await res.json() as { id?: string; summary?: string; timeZone?: string };
  if (!payload.id) return null;
  return {
    id: payload.id,
    summary: String(payload.summary ?? payload.id),
    timeZone: String(payload.timeZone ?? "UTC"),
  };
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

export async function findOrCreateDedicatedCalendar(
  accessToken: string,
  summary: string,
  timeZone: string,
  options?: { alsoMatchPrefix?: string; excludeSummaryIncludes?: string }
): Promise<{ calendar: GoogleCreatedCalendar; reused: boolean }> {
  const listed = await listGoogleCalendars(accessToken);
  const exact = listed.find(
    (cal) => cal.summary.trim() === summary && (cal.selectable || !cal.primary)
  );
  if (exact) {
    return {
      calendar: { id: exact.id, summary: exact.summary, timeZone: exact.timeZone },
      reused: true,
    };
  }

  const prefix = options?.alsoMatchPrefix?.trim();
  const exclude = options?.excludeSummaryIncludes?.trim();
  if (prefix) {
    const prefixed = listed.find((cal) => {
      const name = cal.summary.trim();
      if (!name.startsWith(prefix)) return false;
      if (exclude && name.includes(exclude)) return false;
      return cal.selectable || !cal.primary;
    });
    if (prefixed) {
      return {
        calendar: {
          id: prefixed.id,
          summary: prefixed.summary,
          timeZone: prefixed.timeZone,
        },
        reused: true,
      };
    }
  }

  const calendar = await createGoogleCalendar(accessToken, summary, timeZone);
  return { calendar, reused: false };
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
  const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`;
  const body = eventId ? { ...payload, id: eventId } : payload;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await parseGoogleApiError(res);
    if (eventId && (err.status === 400 || err.code === "invalid")) {
      const retry = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!retry.ok) {
        throw await parseGoogleApiError(retry);
      }
      const retryBody = await retry.json() as Record<string, unknown>;
      return parseEventResponse(retryBody);
    }
    throw err;
  }

  const parsed = await res.json() as Record<string, unknown>;
  return parseEventResponse(parsed);
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
