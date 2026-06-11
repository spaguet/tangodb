import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
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
  if (!authDate || Date.now() / 1000 - authDate > 86_400) return null;

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

  if (Date.now() / 1000 - authDate > 86_400) return null;
  return id;
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

  let linkData = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (linkData.error) {
    const { error: createError } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      app_metadata: { telegram_id: String(telegramId), provider: "telegram" },
      user_metadata: { telegram_id: telegramId },
    });
    if (createError && !createError.message.toLowerCase().includes("already")) {
      console.error("createUser:", createError.message);
      return null;
    }
    linkData = await admin.auth.admin.generateLink({ type: "magiclink", email });
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
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!botToken) {
    return jsonResponse({ error: "TELEGRAM_BOT_TOKEN not configured" }, 500);
  }

  let body: { initData?: string; widgetPayload?: WidgetPayload };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const telegramId = body.initData
    ? await verifyInitData(body.initData, botToken)
    : body.widgetPayload
      ? await verifyLoginWidget(body.widgetPayload, botToken)
      : null;

  if (!telegramId) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Supabase not configured" }, 500);
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
    return jsonResponse({ error: "Forbidden" }, 403);
  }

  const session = await issueSession(telegramId);
  if (!session) {
    return jsonResponse({ error: "Failed to create session" }, 500);
  }

  return jsonResponse(session);
});
