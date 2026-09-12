/**
 * S5b: developer-only Detect / Save / Send test / requeue for the platform outbound bot.
 * Never setWebhook. getUpdates is a one-shot here only — not in platform-notification-worker.
 */

import { isDeveloperVerified } from "../_shared/devAuth.ts";
import { getClientIp, handleOptions, jsonResponse } from "../_shared/http.ts";
import {
  parsePlatformTelegramCandidates,
  telegramBotApi,
  webhookUrlOf,
} from "../_shared/platformTelegramDetect.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createServiceClient, createUserClient, logEvent } from "../_shared/supabase.ts";
import { sendTelegramMessagePlain } from "../_shared/telegramSend.ts";

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 15 * 60_000;

type Action =
  | "get"
  | "detect"
  | "save"
  | "send_test"
  | "requeue_blocked"
  | "delete_webhook";

function botToken(): string {
  return (Deno.env.get("PLATFORM_TELEGRAM_BOT_TOKEN") ?? "").trim();
}

function parseChatId(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw !== 0) {
    return Math.trunc(raw);
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!/^-?\d+$/.test(trimmed)) return null;
    const value = Number(trimmed);
    if (!Number.isFinite(value) || value === 0) return null;
    return value;
  }
  return null;
}

function meSummary(result: unknown): { id: number | null; username: string | null; can_join_groups: boolean | null } {
  if (!result || typeof result !== "object") {
    return { id: null, username: null, can_join_groups: null };
  }
  const row = result as { id?: unknown; username?: unknown; can_join_groups?: unknown };
  return {
    id: typeof row.id === "number" ? row.id : null,
    username: typeof row.username === "string" ? row.username : null,
    can_join_groups: typeof row.can_join_groups === "boolean" ? row.can_join_groups : null,
  };
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
  if (!(await checkRateLimit(`dev-console-platform-bot:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS))) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const userClient = createUserClient(authHeader);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user || !(await isDeveloperVerified(userData.user))) {
    return jsonResponse({ error: "developer_access_required" }, 403, req);
  }

  let body: { action?: string; telegram_chat_id?: unknown; title?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, req);
  }

  const action = (body.action ?? "get") as Action;
  const allowed: Action[] = ["get", "detect", "save", "send_test", "requeue_blocked", "delete_webhook"];
  if (!allowed.includes(action)) {
    return jsonResponse({ error: "invalid_action" }, 400, req);
  }

  const admin = createServiceClient();
  const token = botToken();
  const tokenConfigured = token.length > 0;

  const { data: settings, error: settingsError } = await admin
    .from("platform_notification_settings")
    .select("telegram_chat_id, title, updated_at, updated_by")
    .eq("id", 1)
    .maybeSingle();

  if (settingsError) {
    logEvent("platform_bot_settings_error", { message: settingsError.message });
    return jsonResponse({ error: "Load failed" }, 500, req);
  }

  const chatIdRaw = (settings as { telegram_chat_id?: number | string | null } | null)?.telegram_chat_id;
  const savedChatId = parseChatId(chatIdRaw);

  if (action === "get") {
    const { count } = await admin
      .from("platform_notification_outbox")
      .select("id", { count: "exact", head: true })
      .eq("status", "blocked");

    return jsonResponse(
      {
        ok: true,
        telegram_chat_id: savedChatId,
        title: (settings as { title?: string | null } | null)?.title ?? null,
        updated_at: (settings as { updated_at?: string | null } | null)?.updated_at ?? null,
        token_configured: tokenConfigured,
        blocked_count: count ?? 0,
      },
      200,
      req
    );
  }

  if (action === "save") {
    const chatId = parseChatId(body.telegram_chat_id);
    if (chatId == null) {
      return jsonResponse({ error: "telegram_chat_id_required" }, 400, req);
    }
    const title = typeof body.title === "string" ? body.title : null;
    const { data, error } = await admin.rpc("save_platform_notification_settings", {
      p_chat_id: chatId,
      p_updated_by: userData.user.id,
      p_title: title,
    });
    if (error) {
      logEvent("platform_bot_save_error", { message: error.message });
      return jsonResponse({ error: "Save failed" }, 500, req);
    }
    return jsonResponse({ ok: true, ...(data as Record<string, unknown>) }, 200, req);
  }

  if (action === "requeue_blocked") {
    const { data, error } = await admin.rpc("requeue_all_blocked_platform_notifications");
    if (error) {
      logEvent("platform_bot_requeue_error", { message: error.message });
      return jsonResponse({ error: "Requeue failed" }, 500, req);
    }
    return jsonResponse({ ok: true, requeued: Number(data ?? 0) }, 200, req);
  }

  if (action === "send_test") {
    if (!tokenConfigured || savedChatId == null) {
      return jsonResponse(
        {
          ok: false,
          reason: "config_missing",
          token_configured: tokenConfigured,
          chat_configured: savedChatId != null,
        },
        200,
        req
      );
    }
    const text =
      `[test] TangoDB platform bot\nchat_id: ${savedChatId}\n` +
      "If you see this, Detect/Save works.";
    const sent = await sendTelegramMessagePlain(token, savedChatId, text);
    if (sent.ok) {
      return jsonResponse({ ok: true, sent: true, chat_id: savedChatId }, 200, req);
    }
    if (sent.code === "forbidden" || sent.code === "chat_not_found" || sent.code === "kicked") {
      return jsonResponse(
        { ok: false, reason: sent.code, description: sent.description, blocked: true },
        200,
        req
      );
    }
    return jsonResponse(
      { ok: false, reason: sent.code, description: sent.description },
      200,
      req
    );
  }

  if (action === "delete_webhook") {
    if (!tokenConfigured) {
      return jsonResponse({ ok: false, reason: "config_missing", token_configured: false }, 200, req);
    }
    const cleared = await telegramBotApi(token, "deleteWebhook", { drop_pending_updates: false });
    if (!cleared.ok) {
      return jsonResponse(
        { ok: false, reason: "delete_webhook_failed", description: cleared.description ?? null },
        200,
        req
      );
    }
    await admin.from("platform_audit_log").insert({
      actor_user_id: userData.user.id,
      action: "platform_bot.delete_webhook",
      target_type: "platform_notification_settings",
      metadata: {},
    });
    return jsonResponse({ ok: true, webhook_cleared: true }, 200, req);
  }

  // detect
  if (!tokenConfigured) {
    return jsonResponse(
      { ok: false, reason: "config_missing", token_configured: false, candidates: [] },
      200,
      req
    );
  }

  const me = await telegramBotApi(token, "getMe");
  if (!me.ok) {
    return jsonResponse(
      {
        ok: false,
        reason: "get_me_failed",
        description: me.description ?? null,
        token_configured: true,
        candidates: [],
      },
      200,
      req
    );
  }

  const webhookInfo = await telegramBotApi(token, "getWebhookInfo");
  const webhookUrl = webhookUrlOf(webhookInfo.result);
  if (webhookUrl) {
    return jsonResponse(
      {
        ok: false,
        reason: "webhook_set",
        webhook_url: webhookUrl,
        bot: meSummary(me.result),
        candidates: [],
        hint: "Снимите webhook (deleteWebhook), иначе getUpdates недоступен.",
      },
      200,
      req
    );
  }

  const updates = await telegramBotApi(token, "getUpdates", {
    timeout: 0,
    limit: 100,
    allowed_updates: ["message", "my_chat_member"],
  });
  if (!updates.ok) {
    return jsonResponse(
      {
        ok: false,
        reason: "get_updates_failed",
        description: updates.description ?? null,
        bot: meSummary(me.result),
        candidates: [],
      },
      200,
      req
    );
  }

  const list = Array.isArray(updates.result) ? updates.result : [];
  const candidates = parsePlatformTelegramCandidates(list);

  return jsonResponse(
    {
      ok: true,
      bot: meSummary(me.result),
      webhook_url: null,
      candidates,
    },
    200,
    req
  );
});
