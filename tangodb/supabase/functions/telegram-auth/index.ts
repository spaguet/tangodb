import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/** Telegram Mini App initData — short window per Telegram recommendation */
const MINI_APP_AUTH_MAX_AGE_SEC = 300;
/** Login Widget static token — standard 24h window */
const LOGIN_WIDGET_AUTH_MAX_AGE_SEC = 86_400;

const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

function corsHeadersFor(req: Request): HeadersInit | null {
  const origin = req.headers.get("Origin") ?? "";
  if (!allowedOrigins.length) return null;
  if (!origin || !allowedOrigins.includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    Vary: "Origin",
  };
}

function corsDeniedStatus(): number {
  return allowedOrigins.length ? 403 : 500;
}

function jsonResponse(body: Record<string, unknown>, status: number, req: Request): Response {
  const cors = corsHeadersFor(req);
  if (!cors) {
    return new Response(JSON.stringify(body), {
      status: corsDeniedStatus(),
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

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

async function verifyInitData(initData: string, botToken: string): Promise<number | null> {
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

interface WidgetPayload {
  id: number;
  auth_date: number;
  hash: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}

async function verifyLoginWidget(payload: WidgetPayload, botToken: string): Promise<number | null> {
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

async function findAuthUserByEmail(
  admin: ReturnType<typeof createClient>,
  email: string
) {
  const perPage = 1000;
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const existing = data.users.find((u) => u.email === email);
    if (existing) return existing;
    if (data.users.length < perPage) return null;
  }
}

async function updateTelegramUserMetadata(
  admin: ReturnType<typeof createClient>,
  user: { id: string; app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> },
  telegramId: number
): Promise<void> {
  const { error } = await admin.auth.admin.updateUserById(user.id, {
    app_metadata: { ...user.app_metadata, telegram_id: String(telegramId), provider: "telegram" },
    user_metadata: { ...user.user_metadata, telegram_id: telegramId },
  });
  if (error) throw error;
}

async function ensureTelegramUser(
  admin: ReturnType<typeof createClient>,
  telegramId: number
): Promise<void> {
  const email = `tg_${telegramId}@tangodb.auth`;

  const existing = await findAuthUserByEmail(admin, email);
  if (existing) {
    await updateTelegramUserMetadata(admin, existing, telegramId);
    return;
  }

  const { error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { telegram_id: String(telegramId), provider: "telegram" },
    user_metadata: { telegram_id: telegramId },
  });
  if (createError) {
    if (createError.message.toLowerCase().includes("already")) {
      const retryExisting = await findAuthUserByEmail(admin, email);
      if (retryExisting) {
        await updateTelegramUserMetadata(admin, retryExisting, telegramId);
        return;
      }
    }
    throw createError;
  }
}

async function issueSession(telegramId: number): Promise<{ access_token: string; refresh_token: string } | null> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceRoleKey || !anonKey) return null;

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const email = `tg_${telegramId}@tangodb.auth`;

  try {
    await ensureTelegramUser(admin, telegramId);
  } catch (err) {
    console.error("ensureTelegramUser:", err);
    return null;
  }

  const linkData = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (linkData.error) {
    console.error("generateLink:", linkData.error.message);
    return null;
  }

  const hashedToken = linkData.data?.properties?.hashed_token;
  if (!hashedToken) return null;

  const verifyRes = await fetch(`${supabaseUrl}/auth/v1/verify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
    },
    body: JSON.stringify({ type: "magiclink", token_hash: hashedToken }),
  });

  if (!verifyRes.ok) {
    console.error("verify:", await verifyRes.text());
    return null;
  }

  const session = await verifyRes.json();
  if (!session.access_token || !session.refresh_token) return null;
  return { access_token: session.access_token, refresh_token: session.refresh_token };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    const cors = corsHeadersFor(req);
    if (!cors) {
      return new Response(null, { status: corsDeniedStatus() });
    }
    return new Response("ok", { headers: cors });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, req);
  }

  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!botToken) {
    return jsonResponse({ error: "TELEGRAM_BOT_TOKEN not configured" }, 500, req);
  }

  let body: { initData?: string; widgetPayload?: WidgetPayload };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, req);
  }

  const telegramId = body.initData
    ? await verifyInitData(body.initData, botToken)
    : body.widgetPayload
      ? await verifyLoginWidget(body.widgetPayload, botToken)
      : null;

  if (!telegramId) {
    return jsonResponse({ error: "Unauthorized" }, 401, req);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Supabase not configured" }, 500, req);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: allowedUser } = await admin
    .from("allowed_users")
    .select("telegram_id")
    .eq("telegram_id", telegramId)
    .eq("is_active", true)
    .maybeSingle();

  if (!allowedUser) {
    return jsonResponse({ error: "Forbidden" }, 403, req);
  }

  const session = await issueSession(telegramId);
  if (!session) {
    return jsonResponse({ error: "Failed to create session" }, 500, req);
  }

  return jsonResponse(session, 200, req);
});
