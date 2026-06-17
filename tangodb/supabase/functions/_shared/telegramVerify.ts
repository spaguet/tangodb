/** Telegram Mini App initData — short window per Telegram recommendation */
export const MINI_APP_AUTH_MAX_AGE_SEC = 300;
/** Login Widget static token — standard 24h window */
export const LOGIN_WIDGET_AUTH_MAX_AGE_SEC = 86_400;

function bufferToHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
}

async function sha256(data: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
}

export async function verifyInitData(initData: string, botToken: string): Promise<number | null> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;

  const entries: string[] = [];
  for (const [key, value] of params.entries()) {
    if (key !== "hash") entries.push(`${key}=${value}`);
  }
  entries.sort();
  const dataCheckString = entries.join("\n");

  const secretKey = await hmacSha256(new TextEncoder().encode("WebAppData"), botToken);
  const signature = await hmacSha256(secretKey, dataCheckString);
  if (bufferToHex(signature) !== hash) return null;

  const authDate = Number(params.get("auth_date") ?? 0);
  if (!authDate || Date.now() / 1000 - authDate > MINI_APP_AUTH_MAX_AGE_SEC) return null;

  const userRaw = params.get("user");
  if (!userRaw) return null;

  try {
    const user = JSON.parse(userRaw) as { id?: number };
    return typeof user.id === "number" ? user.id : null;
  } catch {
    return null;
  }
}

export interface WidgetPayload {
  id: number;
  auth_date: number;
  hash: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}

export async function verifyLoginWidget(
  payload: WidgetPayload,
  botToken: string
): Promise<number | null> {
  const { hash, id, auth_date: authDate, ...rest } = payload;
  if (!hash || !id || !authDate) return null;

  const fields: Record<string, string | number> = { auth_date: authDate, id, ...rest };
  const entries = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${value}`)
    .sort();
  const dataCheckString = entries.join("\n");

  const secretKey = await sha256(botToken);
  const signature = await hmacSha256(secretKey, dataCheckString);
  if (bufferToHex(signature) !== hash) return null;

  if (Date.now() / 1000 - authDate > LOGIN_WIDGET_AUTH_MAX_AGE_SEC) return null;
  return id;
}

export function syntheticTelegramEmail(telegramId: number): string {
  return `tg_${telegramId}@tangodb.auth`;
}
