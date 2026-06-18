import type { User } from "https://esm.sh/@supabase/supabase-js@2";

export function isDeveloper(user: User): boolean {
  const allowlist = (Deno.env.get("DEV_CONSOLE_ALLOWLIST") ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const email = user.email?.toLowerCase() ?? "";
  const platformRole = user.app_metadata?.platform_role as string | undefined;
  return platformRole === "developer" || (email.length > 0 && allowlist.includes(email));
}
