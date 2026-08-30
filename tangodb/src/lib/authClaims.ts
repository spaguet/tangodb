import type { Session } from "@supabase/supabase-js";
import type { MemberRole } from "../types/organization";

function decodeJwtPayload(accessToken: string): Record<string, unknown> | null {
  try {
    const segment = accessToken.split(".")[1];
    if (!segment) return null;
    const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(normalized);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readClaim(session: Session | null, key: string): string | null {
  if (!session?.access_token) return null;
  const payload = decodeJwtPayload(session.access_token);
  const value = payload?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function getOrganizationIdFromSession(session: Session | null): string | null {
  return readClaim(session, "organization_id");
}

/** Mini App principal — must not enter CRM team routes. */
export function isRenterActorFromSession(session: Session | null): boolean {
  if (!session) return false;
  const fromUser = session.user?.app_metadata?.actor;
  if (fromUser === "renter") return true;
  if (!session.access_token) return false;
  const payload = decodeJwtPayload(session.access_token);
  const appMeta = payload?.app_metadata;
  if (appMeta && typeof appMeta === "object" && !Array.isArray(appMeta)) {
    return (appMeta as Record<string, unknown>).actor === "renter";
  }
  return false;
}

export function getMemberIdFromSession(session: Session | null): string | null {
  return readClaim(session, "member_id");
}

export function getMemberRoleFromSession(session: Session | null): MemberRole | null {
  const memberRole = readClaim(session, "member_role");
  if (isMemberRole(memberRole)) return memberRole;

  const legacyRole = readClaim(session, "role");
  if (isMemberRole(legacyRole)) return legacyRole;

  return null;
}

/** Stable fingerprint for JWT member claims — used to avoid refresh loops on session object churn. */
export function getClaimsFingerprint(session: Session | null): string {
  if (!session?.access_token) return "";
  const payload = decodeJwtPayload(session.access_token);
  if (!payload) return "";
  const role = getMemberRoleFromSession(session) ?? "";
  const memberId = getMemberIdFromSession(session) ?? "";
  const exp = typeof payload.exp === "number" ? String(payload.exp) : "";
  return `${role}|${memberId}|${exp}`;
}

function isMemberRole(value: string | null): value is MemberRole {
  return (
    value === "owner" ||
    value === "director" ||
    value === "admin" ||
    value === "teacher" ||
    value === "accountant"
  );
}
