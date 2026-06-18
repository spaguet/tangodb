import type { User } from "https://esm.sh/@supabase/supabase-js@2";

function platformRoleFromJwt(authHeader: string): string | undefined {
  try {
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const payload = JSON.parse(atob(token.split(".")[1]));
    const topLevel = payload.platform_role as string | undefined;
    if (topLevel) return topLevel;
    const nested = payload.app_metadata?.platform_role as string | undefined;
    return nested;
  } catch {
    return undefined;
  }
}

export function isDeveloper(user: User, authHeader?: string): boolean {
  const allowlist = (Deno.env.get("DEV_CONSOLE_ALLOWLIST") ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const email = user.email?.toLowerCase() ?? "";
  const platformRole =
    (user.app_metadata?.platform_role as string | undefined) ??
    (authHeader ? platformRoleFromJwt(authHeader) : undefined);

  if (platformRole === "developer") return true;
  if (email.length > 0 && allowlist.includes(email)) return true;
  return false;
}
