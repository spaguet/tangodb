/** Keyed HMAC for rate-limit buckets — do not store raw IP/email in DB. */

async function hmacSecret(): Promise<CryptoKey | null> {
  const raw =
    (Deno.env.get("EDGE_RATE_LIMIT_HMAC_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  if (!raw) return null;
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(raw),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

export async function hmacRateLimitKey(namespace: string, value: string): Promise<string> {
  const normalized = value.trim().toLowerCase();
  const key = await hmacSecret();
  if (!key) {
    return `${namespace}:fallback:${normalized.slice(0, 64)}`;
  }
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${namespace}:${normalized}`)
  );
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${namespace}:${hex}`;
}
