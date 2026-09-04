import type { GoogleAccountSummary, MemberGoogleCalendarBinding } from "./googleCalendarApi";

/** Google OAuth refresh tokens cannot be made permanent — these codes mean sync is blocked. */
export const GOOGLE_CALENDAR_TOKEN_ERROR_CODES = new Set([
  "token_revoked",
  "token_missing",
  "token_decrypt_failed",
]);

type SyncBinding = Pick<MemberGoogleCalendarBinding, "enabled" | "last_error_code"> | null | undefined;

/** True when a calendar binding exists but CRM can no longer write to Google. */
export function isGoogleCalendarSyncCredentialBroken(
  account: GoogleAccountSummary | null | undefined,
  binding: SyncBinding
): boolean {
  if (!binding?.enabled) return false;
  if (!account) return true;
  if (account.status !== "active") return true;
  const code = binding.last_error_code?.trim();
  return Boolean(code && GOOGLE_CALENDAR_TOKEN_ERROR_CODES.has(code));
}

export function googleCalendarSyncStoppedToastKey(
  organizationId: string,
  account: GoogleAccountSummary
): string {
  return `gcal-sync-stopped-toast:${organizationId}:${account.id}:${account.updated_at}`;
}

export function googleCalendarSyncStoppedBannerDismissKey(organizationId: string): string {
  return `gcal-sync-stopped-banner-dismiss:${organizationId}`;
}
