/** Production Edge URLs must use SITE_URL secret; no vercel.app fallback (M39). */
export function requireSiteUrl(): string | null {
  const siteUrl = Deno.env.get("SITE_URL")?.trim().replace(/\/$/, "");
  return siteUrl || null;
}
