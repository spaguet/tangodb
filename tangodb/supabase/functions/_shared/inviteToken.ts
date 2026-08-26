const INVITE_TOKEN_PREFIX = "TDB-INV-";
const INVITE_TOKEN_BYTES = 16;

export function generateInviteToken(): string {
  const bytes = new Uint8Array(INVITE_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${INVITE_TOKEN_PREFIX}${hex}`;
}

export function isInviteTokenFormat(token: string): boolean {
  return /^TDB-INV-[0-9a-f]{32}$/.test(token);
}

export async function hashInviteToken(plaintext: string, pepper: string): Promise<string> {
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
    new TextEncoder().encode(`invite:${plaintext}`)
  );
  return [...new Uint8Array(signature)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
