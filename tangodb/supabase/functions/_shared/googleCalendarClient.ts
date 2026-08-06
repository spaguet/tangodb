/**
 * Google Calendar API client — list/create calendars, access token from stored credential.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
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

  if (row.status === "revoked") {
    throw new GoogleCalendarApiError(401, "token_revoked", "Google account requires reconnection");
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

export async function listGoogleCalendars(accessToken: string): Promise<GoogleCalendarListEntry[]> {
  const res = await fetch(`${CALENDAR_API_BASE}/users/me/calendarList?minAccessRole=freeBusyReader`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

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
      return {
        id: item.id as string,
        summary: String(item.summary ?? item.id),
        primary: item.primary === true,
        accessRole,
        timeZone: String(item.timeZone ?? "UTC"),
        selectable: isWritableAccessRole(accessRole),
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
