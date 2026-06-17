const KEY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateKeySegment(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return [...bytes]
    .map((b) => KEY_ALPHABET[b % KEY_ALPHABET.length])
    .join("");
}

export function generateAccessKey(keyType: "demo" | "lifetime"): string {
  const prefix = keyType === "demo" ? "TDB-DEMO" : "TDB-LIFE";
  return `${prefix}-${generateKeySegment(4)}-${generateKeySegment(4)}-${generateKeySegment(4)}`;
}

export async function hashAccessKey(plaintext: string, pepper: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(plaintext)
  );
  return [...new Uint8Array(signature)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
