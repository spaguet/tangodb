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

export function getMemberIdFromSession(session: Session | null): string | null {
  return readClaim(session, "member_id");
}

export function getMemberRoleFromSession(session: Session | null): MemberRole | null {
  const role = readClaim(session, "role");
  if (
    role === "owner" ||
    role === "director" ||
    role === "admin" ||
    role === "teacher" ||
    role === "accountant"
  ) {
    return role;
  }
  return null;
}
