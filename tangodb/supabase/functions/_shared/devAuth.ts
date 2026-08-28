import type { User } from "https://esm.sh/@supabase/supabase-js@2";

/** Platform developer after auth.getUser() — only verified app_metadata, never a decoded JWT payload. */
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
