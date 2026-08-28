import { constantTimeEqual } from "./constantTime.ts";
import { logEvent } from "./supabase.ts";

function isLocalDevEnvironment(): boolean {
  const env = (Deno.env.get("ENVIRONMENT") ?? "").toLowerCase();
  if (env === "local" || env === "development" || env === "dev") {
    return true;
  }
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  return (
    url.includes("127.0.0.1") ||
    url.includes("localhost") ||
    url.includes("kong:8000")
  );
}

export const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

if (!allowedOrigins.length && !isLocalDevEnvironment()) {
  logEvent("allowed_origins_missing", {
    environment: Deno.env.get("ENVIRONMENT") ?? "unknown",
  });
  console.error(
    "[tangodb] ALLOWED_ORIGINS is empty on a hosted environment; browser Edge calls return 503 allowed_origins_not_configured"
  );
}

export function corsHeadersFor(req: Request): HeadersInit | null {
  const origin = req.headers.get("Origin") ?? "";
  if (!allowedOrigins.length) return null;
  if (!origin || !allowedOrigins.includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    Vary: "Origin",
  };
}

export function corsDeniedStatus(): number {
  if (!allowedOrigins.length) {
    return isLocalDevEnvironment() ? 500 : 503;
  }
  return 403;
}

function corsDeniedError(): string {
  return allowedOrigins.length ? "origin_not_allowed" : "allowed_origins_not_configured";
}

export function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  req: Request
): Response {
  const cors = corsHeadersFor(req);
  if (!cors) {
    // pg_cron / pg_net callers send no Origin; they authenticate via x-cron-secret.
    if (verifyCronSecret(req)) {
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({ ...body, error: body.error ?? corsDeniedError() }),
      {
        status: corsDeniedStatus(),
        headers: { "Content-Type": "application/json" },
      }
    );
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

/** Trusted CDN client IP only (cf-connecting-ip). Do not use x-forwarded-for. */
export function getClientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  return "unknown";
}

export function verifyCronSecret(req: Request): boolean {
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected) return false;
  const provided = req.headers.get("x-cron-secret");
  if (!provided) return false;
  return constantTimeEqual(provided, expected);
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
