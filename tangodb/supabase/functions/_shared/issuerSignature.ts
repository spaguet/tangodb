import { hashAccessKey, timingSafeEqual } from "./accessKey.ts";

export async function hashIssuerSignature(signature: string, pepper: string): Promise<string> {
  return hashAccessKey(`issuer:${signature.trim()}`, pepper);
}

export async function validateIssuerSignature(
  signature: string
): Promise<{ ok: true; hash: string } | { ok: false; error: string }> {
  const expected = Deno.env.get("DEV_CONSOLE_ISSUER_SIGNATURE")?.trim();
  const pepper = Deno.env.get("ACCESS_KEY_PEPPER");

  if (!expected || !pepper) {
    return { ok: false, error: "issuer_signature_not_configured" };
  }

  const provided = signature.trim();
  if (!provided) {
    return { ok: false, error: "issuer_signature_required" };
  }

  const providedHash = await hashIssuerSignature(provided, pepper);
  const expectedHash = await hashIssuerSignature(expected, pepper);

  if (!timingSafeEqual(providedHash, expectedHash)) {
    return { ok: false, error: "invalid_issuer_signature" };
  }

  return { ok: true, hash: providedHash };
}
