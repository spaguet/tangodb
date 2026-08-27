export function getSiteUrl(): string {
  const configured = import.meta.env.VITE_SITE_URL?.trim();
  if (!configured) return "";
  return configured.replace(/\/$/, "");
}

/** Auth redirect origins must come from VITE_SITE_URL only (M15). */
export function requireSiteUrl(): string {
  const url = getSiteUrl();
  if (!url) {
    throw new Error("VITE_SITE_URL is not configured");
  }
  return url;
}
