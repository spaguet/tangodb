import type { User } from "https://esm.sh/@supabase/supabase-js@2";
import { createServiceClient } from "./supabase.ts";

/** Fast sync check: JWT/app_metadata from auth.getUser() + server allowlist secret. */
export function isDeveloper(user: User, _authHeader?: string): boolean {
  const allowlist = (Deno.env.get("DEV_CONSOLE_ALLOWLIST") ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const email = user.email?.toLowerCase() ?? "";
  const platformRole = user.app_metadata?.platform_role as string | undefined;

  if (platformRole === "developer") return true;
  if (email.length > 0 && allowlist.includes(email)) return true;
  return false;
}

/** Authoritative check: sync path + auth.users via is_platform_developer RPC. */
export async function isDeveloperVerified(user: User): Promise<boolean> {
  if (isDeveloper(user)) return true;

  try {
    const admin = createServiceClient();
    const { data, error } = await admin.rpc("is_platform_developer", {
      p_user_id: user.id,
    });
    if (!error && data === true) return true;
  } catch {
    /* service client / RPC unavailable */
  }

  return false;
}
