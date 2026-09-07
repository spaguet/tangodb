import { hashAccessKey, timingSafeEqual } from "./accessKey.ts";

/** Pre-computed HMAC stored in DEV_CONSOLE_ISSUER_SIGNATURE (optional format). */
const ISSUER_HASH_HEX = /^[0-9a-f]{64}$/i;

export async function hashIssuerSignature(signature: string, pepper: string): Promise<string> {
  return hashAccessKey(`issuer:${normalizeIssuerSignature(signature)}`, pepper);
}

function normalizeIssuerSignature(value: string): string {
  return value.trim().normalize("NFC");
}

export async function validateIssuerSignature(
  signature: string
): Promise<{ ok: true; hash: string } | { ok: false; error: string }> {
  const expectedRaw = Deno.env.get("DEV_CONSOLE_ISSUER_SIGNATURE");
  const pepper = Deno.env.get("ACCESS_KEY_PEPPER");

  if (!expectedRaw?.trim() || !pepper) {
    return { ok: false, error: "issuer_signature_not_configured" };
  }

  const provided = normalizeIssuerSignature(signature);
  if (!provided) {
    return { ok: false, error: "issuer_signature_required" };
  }

  const providedHash = await hashIssuerSignature(provided, pepper);
  const expected = normalizeIssuerSignature(expectedRaw);

  // Secret may store pre-computed issuer HMAC (64 hex) or plaintext passphrase.
  if (ISSUER_HASH_HEX.test(expected)) {
    if (!timingSafeEqual(providedHash, expected.toLowerCase())) {
      return { ok: false, error: "invalid_issuer_signature" };
    }
    return { ok: true, hash: providedHash };
  }

  if (!timingSafeEqual(provided, expected)) {
    return { ok: false, error: "invalid_issuer_signature" };
  }

  return { ok: true, hash: providedHash };
}
