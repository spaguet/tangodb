const INVITE_TOKEN_PREFIX = "TDB-INV-";
const INVITE_TOKEN_BYTES = 16;
const INVITE_TOKEN_RE = /^TDB-INV-([0-9a-fA-F]{32})$/;

export function generateInviteToken(): string {
  const bytes = new Uint8Array(INVITE_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${INVITE_TOKEN_PREFIX}${hex}`;
}

/** Strip copy/paste junk; canonical form is TDB-INV- + lowercase hex. */
export function normalizeInviteToken(token: string): string | null {
  const cleaned = token.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  const match = INVITE_TOKEN_RE.exec(cleaned);
  if (!match) return null;
  return `${INVITE_TOKEN_PREFIX}${match[1].toLowerCase()}`;
}

export function isInviteTokenFormat(token: string): boolean {
  return normalizeInviteToken(token) != null;
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
