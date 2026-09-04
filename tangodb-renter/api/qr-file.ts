type QrFileRequest = {
  method?: string;
  query: Record<string, string | string[] | undefined>;
};

type QrFileResponse = {
  status: (code: number) => QrFileResponse;
  setHeader: (name: string, value: string) => void;
  send: (body: string | Buffer) => void;
  end: () => void;
};

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

export default async function handler(req: QrFileRequest, res: QrFileResponse): Promise<void> {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.status(405).send("Method not allowed");
      return;
    }

    const rawU = req.query.u;
    const src = (Array.isArray(rawU) ? rawU[0] : rawU) ?? "";
    if (!isStudioQrSignedUrl(src)) {
      res.status(404).send("Not found");
      return;
    }

    const rawName = req.query.name;
    const name = sanitizeQrDownloadFilename(
      (Array.isArray(rawName) ? rawName[0] : rawName) ?? "studio-qr.png"
    );

    const upstream = await fetch(src, { redirect: "follow" });
    if (!upstream.ok) {
      res.status(404).send("Not found");
      return;
    }

    const contentType = (upstream.headers.get("content-type") ?? "").toLowerCase();
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    if (bytes.length < 200 || (!contentType.startsWith("image/") && !looksLikeImage(bytes))) {
      res.status(404).send("Not found");
      return;
    }

    const resolvedType = contentType.startsWith("image/") ? contentType.split(";")[0] : "image/png";
    res.setHeader("Content-Type", resolvedType);
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    res.setHeader("Cache-Control", "private, max-age=60");
    res.setHeader("Content-Length", String(bytes.length));

    if (req.method === "HEAD") {
      res.status(200).end();
      return;
    }

    res.status(200).send(Buffer.from(bytes));
  } catch {
    res.status(500).send("Internal error");
  }
}
