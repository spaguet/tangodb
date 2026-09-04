/** Same-origin proxy for Telegram.WebApp.downloadFile (URL must be the Mini App domain). */

export function isStudioQrSignedUrl(raw: string): boolean {
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
  return /\/storage\/v1\/object\/sign\/org-rental-qr\//.test(url.pathname);
}

export function sanitizeQrDownloadFilename(name: string): string {
  const trimmed = name.trim().replace(/[/\\?%*:|"<>]/g, "-");
  const safe = trimmed.slice(0, 80);
  return safe || "studio-qr.png";
}

export function miniAppQrProxyUrl(origin: string, signedUrl: string, fileName: string): string {
  const base = origin.replace(/\/$/, "");
  const u = new URL("/api/qr-file", `${base}/`);
  u.searchParams.set("u", signedUrl);
  u.searchParams.set("name", sanitizeQrDownloadFilename(fileName));
  return u.toString();
}

export async function proxyStudioQrRequest(req: Request): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }

  const page = new URL(req.url);
  const src = page.searchParams.get("u") ?? "";
  if (!isStudioQrSignedUrl(src)) {
    return new Response("Not found", { status: 404 });
  }

  const name = sanitizeQrDownloadFilename(page.searchParams.get("name") ?? "studio-qr.png");
  const upstream = await fetch(src, { redirect: "follow" });
  if (!upstream.ok) {
    return new Response("Not found", { status: 404 });
  }

  const contentType = (upstream.headers.get("content-type") ?? "").toLowerCase();
  const bytes = new Uint8Array(await upstream.arrayBuffer());
  if (bytes.length < 200) {
    return new Response("Not found", { status: 404 });
  }
  if (!contentType.startsWith("image/")) {
    return new Response("Not found", { status: 404 });
  }

  const resolvedType = contentType.split(";")[0] || "image/png";
  const headers = new Headers({
    "Content-Type": resolvedType,
    "Content-Disposition": `attachment; filename="${name}"`,
    "Cache-Control": "private, max-age=60",
    "Content-Length": String(bytes.length),
  });

  if (req.method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }

  return new Response(bytes, { status: 200, headers });
}
