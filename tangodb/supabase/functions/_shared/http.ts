export const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

export function corsHeadersFor(req: Request): HeadersInit | null {
  const origin = req.headers.get("Origin") ?? "";
  if (!allowedOrigins.length) return null;
  if (!origin || !allowedOrigins.includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-cron-secret",
    Vary: "Origin",
  };
}

export function corsDeniedStatus(): number {
  return allowedOrigins.length ? 403 : 500;
}

export function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  req: Request
): Response {
  const cors = corsHeadersFor(req);
  if (!cors) {
    return new Response(JSON.stringify(body), {
      status: corsDeniedStatus(),
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

export function handleOptions(req: Request): Response {
  const cors = corsHeadersFor(req);
  if (!cors) {
    return new Response(null, { status: corsDeniedStatus() });
  }
  return new Response("ok", { headers: cors });
}

export function getClientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
}

export function verifyCronSecret(req: Request): boolean {
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected) return false;
  const provided = req.headers.get("x-cron-secret") ?? req.headers.get("authorization");
  if (!provided) return false;
  if (provided === expected) return true;
  if (provided === `Bearer ${expected}`) return true;
  return false;
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
