import { compare, hash } from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";
import { generateKeySegment } from "./accessKey.ts";

export function generateRecoveryCode(): string {
  return `${generateKeySegment(4)}-${generateKeySegment(4)}-${generateKeySegment(4)}`;
}

export function normalizeRecoveryCode(input: string): string {
  return input.replace(/\s+/g, "").toUpperCase();
}

export async function hashRecoveryCode(plaintext: string): Promise<string> {
  return await hash(normalizeRecoveryCode(plaintext));
}

export async function verifyRecoveryCode(plaintext: string, codeHash: string): Promise<boolean> {
  if (!plaintext.trim() || !codeHash) return false;
  try {
    return await compare(normalizeRecoveryCode(plaintext), codeHash);
  } catch {
    return false;
  }
}
