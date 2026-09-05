/** Same-origin proxy for Telegram.WebApp.downloadFile (URL must be the Mini App domain). */

export function isExportsSignedUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  const supabaseHost = host === "supabase.co" || host.endsWith(".supabase.co");
  if (!supabaseHost) return false;
  return /\/storage\/v1\/object\/sign\/exports\//.test(url.pathname);
}

export function sanitizeExportFilename(name: string): string {
  const trimmed = name.trim().replace(/[/\\?%*:|"<>]/g, "-");
  const ascii = trimmed.replace(/[^\w.\-]/g, "_").replace(/_+/g, "_").slice(0, 80);
  if (!ascii) return "schedule.png";
  return ascii.toLowerCase().endsWith(".png") ? ascii : `${ascii}.png`;
}

export function crmExportProxyUrl(origin: string, signedUrl: string, fileName: string): string {
  const base = origin.replace(/\/$/, "");
  const u = new URL("/api/export-file", `${base}/`);
  u.searchParams.set("u", signedUrl);
  u.searchParams.set("name", sanitizeExportFilename(fileName));
  return u.toString();
}

export async function verifyImageDownloadUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    if (!res.ok) return false;
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!contentType.startsWith("image/")) return false;
    const len = res.headers.get("content-length");
    if (len && Number(len) < 200) return false;
    return true;
  } catch {
    return false;
  }
}
