type ExportFileRequest = {
  method?: string;
  query: Record<string, string | string[] | undefined>;
};

type ExportFileResponse = {
  status: (code: number) => ExportFileResponse;
  setHeader: (name: string, value: string) => void;
  send: (body: string | Buffer) => void;
  end: () => void;
};

function isExportsSignedUrl(raw: string): boolean {
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

function sanitizeExportFilename(name: string): string {
  const trimmed = name.trim().replace(/[/\\?%*:|"<>]/g, "-");
  const ascii = trimmed.replace(/[^\w.\-]/g, "_").replace(/_+/g, "_").slice(0, 80);
  if (!ascii) return "schedule.png";
  return ascii.toLowerCase().endsWith(".png") ? ascii : `${ascii}.png`;
}

function looksLikePng(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  );
}

export default async function handler(req: ExportFileRequest, res: ExportFileResponse): Promise<void> {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.status(405).send("Method not allowed");
      return;
    }

    const rawU = req.query.u;
    const src = (Array.isArray(rawU) ? rawU[0] : rawU) ?? "";
    if (!isExportsSignedUrl(src)) {
      res.status(404).send("Not found");
      return;
    }

    const rawName = req.query.name;
    const name = sanitizeExportFilename((Array.isArray(rawName) ? rawName[0] : rawName) ?? "schedule.png");

    const upstream = await fetch(src, { redirect: "follow" });
    if (!upstream.ok) {
      res.status(404).send("Not found");
      return;
    }

    const contentType = (upstream.headers.get("content-type") ?? "").toLowerCase();
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    if (bytes.length < 200 || (!contentType.startsWith("image/") && !looksLikePng(bytes))) {
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
