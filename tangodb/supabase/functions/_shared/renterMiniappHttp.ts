const DEFAULT_DEV_ORIGIN = "http://localhost:3002";

/** Headers sent by supabase-js `functions.invoke` (preflight must allow all of them). */
export const SUPABASE_INVOKE_ALLOW_HEADERS =
  "authorization, x-client-info, apikey, content-type, x-supabase-api-version, prefer, x-region";

export function renterMiniappAllowedOrigins(): string[] {
  const raw = (Deno.env.get("RENTER_MINIAPP_ORIGIN") ?? DEFAULT_DEV_ORIGIN).trim();
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

/** CORS only for tangodb-renter — never merged into ALLOWED_ORIGINS. */
export function renterMiniappCorsHeaders(req: Request): HeadersInit | null {
  const origin = req.headers.get("Origin") ?? "";
  if (!origin) return null;
  const allowed = renterMiniappAllowedOrigins();
  if (!allowed.includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": SUPABASE_INVOKE_ALLOW_HEADERS,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

export function renterMiniappJsonResponse(
  body: Record<string, unknown>,
  status: number,
  req: Request
): Response {
  const cors = renterMiniappCorsHeaders(req);
  if (!cors) {
    return new Response(JSON.stringify({ error: "origin_not_allowed" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

export function handleRenterMiniappOptions(req: Request): Response {
  const cors = renterMiniappCorsHeaders(req);
  if (!cors) {
    return new Response(null, { status: 403 });
  }
  return new Response(null, {
    status: 204,
    headers: {
      ...cors,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}
