/** Self-contained Edge handler — do not import from src/ (Vercel bundles api/ only). */

export const config = { runtime: "edge" };

function isStudioQrSignedUrl(raw: string): boolean {
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

function sanitizeQrDownloadFilename(name: string): string {
  const trimmed = name.trim().replace(/[/\\?%*:|"<>]/g, "-");
  const safe = trimmed.slice(0, 80);
  return safe || "studio-qr.png";
}

function looksLikeImage(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return true;
  }
  return false;
}

export default async function handler(req: Request): Promise<Response> {
  try {
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
    if (bytes.length < 200 || (!contentType.startsWith("image/") && !looksLikeImage(bytes))) {
      return new Response("Not found", { status: 404 });
    }

    const resolvedType = contentType.startsWith("image/") ? contentType.split(";")[0] : "image/png";
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
  } catch {
    return new Response("Internal error", { status: 500 });
  }
}
