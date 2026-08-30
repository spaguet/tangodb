/**
 * Save org Telegram bot token: getMe + UNIQUE bot_id + setWebhook, then encrypt.
 * CRM JWT. CORS = ALLOWED_ORIGINS (not Mini App origin).
 */

import {
  getClientIp,
  handleOptions,
  jsonResponse,
} from "../_shared/http.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createServiceClient, createUserClient, logEvent } from "../_shared/supabase.ts";
import {
  encryptTelegramBotToken,
  loadTelegramTokenKey,
  uint8ArrayToByteaHex,
} from "../_shared/telegramToken.ts";

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 15 * 60_000;

type SetBotBody = {
  bot_token?: string;
  app_short_name?: string;
};

function randomSecretHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function webhookUrl(token: string): string | null {
  const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
  if (!base) return null;
  return `${base}/functions/v1/renter-telegram-webhook?t=${encodeURIComponent(token)}`;
}

async function telegramApi(
  botToken: string,
  method: string,
  body?: Record<string, unknown>
): Promise<{ ok: boolean; result?: Record<string, unknown>; description?: string }> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  try {
    return (await res.json()) as {
      ok: boolean;
      result?: Record<string, unknown>;
      description?: string;
    };
  } catch {
    return { ok: false, description: "telegram_http" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, req);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Unauthorized" }, 401, req);
  }

  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`renter-set-bot:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS))) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const userClient = createUserClient(authHeader);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return jsonResponse({ error: "Unauthorized" }, 401, req);
  }

  const { data: canManage, error: canErr } = await userClient.rpc("can_manage_settings");
  if (canErr || canManage !== true) {
    return jsonResponse({ error: "Forbidden" }, 403, req);
  }

  const { data: orgId, error: orgErr } = await userClient.rpc("auth_organization_id");
  if (orgErr || !orgId) {
    return jsonResponse({ error: "Unauthorized" }, 401, req);
  }

  let body: SetBotBody;
  try {
    body = (await req.json()) as SetBotBody;
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, req);
  }

  const botToken = (body.bot_token ?? "").trim();
  const appShortName = (body.app_short_name ?? "").trim();
  if (!botToken) {
    return jsonResponse({ error: "renter.channel.tokenRequired" }, 400, req);
  }

  const key = await loadTelegramTokenKey();
  if (!key) {
    logEvent("renter_bot_encryption_key_missing", { org: "redacted" });
    return jsonResponse({ error: "renter.channel.encryptionUnavailable" }, 503, req);
  }

  const me = await telegramApi(botToken, "getMe");
  const meResult = me.result ?? {};
  const botId = Number(meResult.id);
  const username = typeof meResult.username === "string" ? meResult.username : "";
  if (!me.ok || !Number.isFinite(botId) || botId <= 0 || meResult.is_bot !== true || !username) {
    return jsonResponse({ error: "renter.channel.getMeFailed" }, 400, req);
  }

  const admin = createServiceClient();
  const { data: snapshot } = await admin.rpc("get_organization_renter_bot_internal", {
    p_org: orgId,
  });
  const prev = snapshot as Record<string, unknown> | null;

  const webhookToken = randomSecretHex(24);
  const webhookSecret = randomSecretHex(32);
  const hookUrl = webhookUrl(webhookToken);
  if (!hookUrl) {
    return jsonResponse({ error: "renter.channel.webhookUrlMissing" }, 500, req);
  }

  const setHook = await telegramApi(botToken, "setWebhook", {
    url: hookUrl,
    secret_token: webhookSecret,
    allowed_updates: ["message", "my_chat_member"],
    drop_pending_updates: false,
  });
  if (!setHook.ok) {
    return jsonResponse({ error: "renter.channel.setWebhookFailed" }, 400, req);
  }

  const encrypted = await encryptTelegramBotToken(key, botToken);
  const last4 = botToken.slice(-4);

  const { data: committed, error: commitError } = await admin.rpc("commit_organization_renter_bot", {
    p_payload: {
      organization_id: orgId,
      telegram_bot_id: String(botId),
      bot_username: username,
      bot_token_last4: last4,
      app_short_name: appShortName || undefined,
      encrypted_bot_token_hex: uint8ArrayToByteaHex(encrypted),
      webhook_token: webhookToken,
      webhook_secret: webhookSecret,
    },
  });

  const result = committed as { success?: boolean; error?: string } | null;
  if (commitError || !result?.success) {
    await telegramApi(botToken, "deleteWebhook", { drop_pending_updates: false });
    if (prev?.exists === true) {
      await admin.rpc("restore_organization_renter_bot", {
        p_payload: {
          organization_id: orgId,
          encrypted_bot_token_hex: prev.encrypted_bot_token_hex,
          telegram_bot_id: prev.telegram_bot_id != null ? String(prev.telegram_bot_id) : null,
          bot_username: prev.bot_username,
          bot_token_last4: prev.bot_token_last4,
          webhook_token: prev.webhook_token,
          webhook_secret: prev.webhook_secret,
        },
      });
    } else {
      await admin.rpc("restore_organization_renter_bot", {
        p_payload: { organization_id: orgId },
      });
    }
    const err = result?.error ?? "renter.channel.botSaveFailed";
    return jsonResponse({ error: err }, err === "renter.channel.botTaken" ? 409 : 400, req);
  }

  return jsonResponse(
    {
      success: true,
      token_last4: last4,
      bot_username: username,
      miniapp_url: result.miniapp_url ?? null,
    },
    200,
    req
  );
});
