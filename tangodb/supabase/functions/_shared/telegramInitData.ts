import { constantTimeEqual } from "./constantTime.ts";

export type TelegramWebAppUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  allows_write_to_pm?: boolean;
};

export type VerifiedInitData = {
  organizationId: string;
  user: TelegramWebAppUser;
  authDate: number;
  hash: string;
  allowsWriteToPm: boolean;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ordinal/byte sort — not localeCompare. */
function sortedInitDataKeys(params: URLSearchParams): string[] {
  return [...params.keys()].filter((k) => k !== "hash").sort();
}

export function buildDataCheckString(params: URLSearchParams): string {
  return sortedInitDataKeys(params)
    .map((key) => `${key}=${params.get(key) ?? ""}`)
    .join("\n");
}

async function hmacSha256(key: ArrayBuffer, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
}

function bufferToHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function computeTelegramWebAppHash(
  botToken: string,
  dataCheckString: string
): Promise<string> {
  const webAppDataKey = await hmacSha256(
    new TextEncoder().encode("WebAppData"),
    botToken
  );
  const digest = await hmacSha256(webAppDataKey, dataCheckString);
  return bufferToHex(digest);
}

/** Constant-time compare; unequal lengths → false (generic fail). */
export function verifyTelegramWebAppHash(
  expectedHex: string,
  actualHex: string
): boolean {
  if (expectedHex.length !== actualHex.length) return false;
  return constantTimeEqual(expectedHex.toLowerCase(), actualHex.toLowerCase());
}

export async function verifyInitDataWithBotToken(
  initData: string,
  botToken: string
): Promise<{ ok: true; params: URLSearchParams; hash: string } | { ok: false }> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false };

  const dataCheckString = buildDataCheckString(params);
  const calculated = await computeTelegramWebAppHash(botToken, dataCheckString);
  if (!verifyTelegramWebAppHash(hash, calculated)) {
    return { ok: false };
  }

  return { ok: true, params, hash };
}

export function parseTelegramUser(raw: string | null): TelegramWebAppUser | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as TelegramWebAppUser;
    if (typeof parsed.id !== "number" || !Number.isInteger(parsed.id) || parsed.id <= 0) {
      return null;
    }
    if (parsed.is_bot === true) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function buildDisplayName(user: TelegramWebAppUser): string {
  const parts = [user.first_name, user.last_name]
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter(Boolean);
  const joined = parts.join(" ").trim();
  return joined.length > 0 ? joined.slice(0, 80) : "Telegram user";
}

export function validateStartParam(startParam: string | null): string | null {
  if (!startParam || startParam.trim() === "") return null;
  const trimmed = startParam.trim();
  if (!UUID_RE.test(trimmed)) return null;
  return trimmed;
}

export function validateAuthDate(
  authDateSec: number,
  nowMs: number = Date.now()
): boolean {
  if (!Number.isFinite(authDateSec) || authDateSec <= 0) return false;
  const authMs = authDateSec * 1000;
  const skewMs = 60_000;
  if (authMs > nowMs + skewMs) return false;
  const maxAgeMs = 10 * 60_000;
  if (nowMs - authMs > maxAgeMs) return false;
  return true;
}

export function extractVerifiedInitData(
  params: URLSearchParams,
  hash: string
): VerifiedInitData | null {
  const startParam = validateStartParam(params.get("start_param"));
  if (!startParam) return null;

  const user = parseTelegramUser(params.get("user"));
  if (!user) return null;

  const authDate = Number(params.get("auth_date"));
  if (!validateAuthDate(authDate)) return null;

  if (params.has("chat") || params.has("receiver")) {
    return null;
  }

  return {
    organizationId: startParam,
    user,
    authDate,
    hash,
    allowsWriteToPm: user.allows_write_to_pm === true,
  };
}

/** Dummy HMAC path to reduce timing oracle between failure modes. */
export async function runDummyHmac(): Promise<void> {
  const dummyToken = "0:dummy";
  const dummyString = "auth_date=0\nquery_id=0";
  await computeTelegramWebAppHash(dummyToken, dummyString);
}
