/**
 * AES-GCM encrypt/decrypt for org Telegram bot tokens.
 * Secret: TELEGRAM_TOKEN_ENCRYPTION_KEY, or SECRETS_ENCRYPTION_KEY (not Google-only).
 * Do NOT use GOOGLE_TOKEN_ENCRYPTION_KEY — rotating Google would brick every studio bot.
 * R3a mint reuses this module; do not copy AES into renter-telegram-auth.
 */

const TOKEN_VERSION = 1;
const IV_LENGTH = 12;

export class TelegramTokenError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "TelegramTokenError";
  }
}

function decodeEncryptionKey(material: string): Uint8Array | null {
  const trimmed = material.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      bytes[i] = parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }
  try {
    const padded = trimmed.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
    const binary = atob(padded + pad);
    const decoded = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    if (decoded.length === 32) return decoded;
  } catch {
    return null;
  }
  return null;
}

export async function loadTelegramTokenKey(): Promise<CryptoKey | null> {
  const material = (
    Deno.env.get("TELEGRAM_TOKEN_ENCRYPTION_KEY") ??
    Deno.env.get("SECRETS_ENCRYPTION_KEY") ??
    ""
  ).trim();
  if (!material) return null;
  const keyBytes = decodeEncryptionKey(material);
  if (!keyBytes) return null;
  return crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptTelegramBotToken(
  key: CryptoKey,
  plaintext: string
): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  const out = new Uint8Array(1 + IV_LENGTH + ciphertext.byteLength);
  out[0] = TOKEN_VERSION;
  out.set(iv, 1);
  out.set(new Uint8Array(ciphertext), 1 + IV_LENGTH);
  return out;
}

export async function decryptTelegramBotToken(
  key: CryptoKey,
  data: Uint8Array
): Promise<string> {
  if (data.length < 1 + IV_LENGTH + 16) {
    throw new TelegramTokenError("decrypt_failed", "ciphertext too short");
  }
  if (data[0] !== TOKEN_VERSION) {
    throw new TelegramTokenError("decrypt_failed", `unsupported token_version ${data[0]}`);
  }
  const iv = data.slice(1, 1 + IV_LENGTH);
  const ciphertext = data.slice(1 + IV_LENGTH);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

export function uint8ArrayToByteaHex(bytes: Uint8Array): string {
  return "\\x" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function byteaToUint8Array(value: unknown): Uint8Array | null {
  if (!value) return null;
  if (value instanceof Uint8Array) return value;
  if (typeof value === "string") {
    const hex = value.startsWith("\\x") ? value.slice(2) : value;
    if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) return null;
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }
  return null;
}

export function hexToUint8Array(hex: string): Uint8Array | null {
  const trimmed = hex.startsWith("\\x") ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]*$/.test(trimmed) || trimmed.length % 2 !== 0) return null;
  const bytes = new Uint8Array(trimmed.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
