/**
 * Telegram Bot webhook. verify_jwt=false.
 * Auth: X-Telegram-Bot-Api-Secret-Token (constant-time) + unguessable webhook_token query.
 * No Mini App CORS. Do not log token/secret/message body.
 */

import { constantTimeEqual } from "../_shared/constantTime.ts";
import { createServiceClient, logEvent } from "../_shared/supabase.ts";

type TelegramUser = { id?: number };
type TelegramMessage = {
  from?: TelegramUser;
  text?: string;
  chat?: { type?: string };
};
type TelegramChatMemberUpdated = {
  from?: TelegramUser;
  new_chat_member?: { status?: string; user?: TelegramUser };
};
type TelegramUpdate = {
  update_id?: number;
  message?: TelegramMessage;
  my_chat_member?: TelegramChatMemberUpdated;
};

function dummyCompare(provided: string): boolean {
  return constantTimeEqual(provided, "0".repeat(Math.max(provided.length, 32)));
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(null, { status: 405 });
  }

  const url = new URL(req.url);
  const webhookToken = (url.searchParams.get("t") ?? "").trim();
  const secretHeader = req.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";

  if (!webhookToken) {
    dummyCompare(secretHeader);
    return new Response(null, { status: 403 });
  }

  let body: TelegramUpdate;
  try {
    body = (await req.json()) as TelegramUpdate;
  } catch {
    return new Response(null, { status: 400 });
  }

  const admin = createServiceClient();
  const { data: lookup, error: lookupError } = await admin.rpc(
    "lookup_renter_channel_by_webhook_token",
    { p_webhook_token: webhookToken }
  );

  if (lookupError) {
    logEvent("renter_telegram_webhook_lookup_error", { code: lookupError.code ?? "rpc" });
    dummyCompare(secretHeader);
    return new Response(null, { status: 500 });
  }

  const row = lookup as {
    success?: boolean;
    organization_id?: string;
    webhook_secret?: string;
    telegram_bot_id?: number;
  } | null;

  if (!row?.success || !row.webhook_secret || !row.organization_id) {
    dummyCompare(secretHeader);
    return new Response(null, { status: 403 });
  }

  if (!constantTimeEqual(secretHeader, row.webhook_secret)) {
    return new Response(null, { status: 403 });
  }

  const updateId = body.update_id;
  if (updateId == null || !Number.isFinite(updateId)) {
    return new Response("ok", { status: 200 });
  }

  const message = body.message;
  const member = body.my_chat_member;
  const isPrivateStart =
    message?.chat?.type === "private" &&
    typeof message.text === "string" &&
    /^\/start(?:\s|$)/.test(message.text);
  const memberStatus = member?.new_chat_member?.status ?? "";
  const isMemberJoin = memberStatus === "member" || memberStatus === "restricted";
  const isBlocked = memberStatus === "kicked" || memberStatus === "left";

  if (!message && !member) {
    return new Response("ok", { status: 200 });
  }

  const telegramId = message?.from?.id ?? member?.from?.id ?? member?.new_chat_member?.user?.id;
  if (telegramId == null || telegramId <= 0) {
    return new Response("ok", { status: 200 });
  }

  const { error: ingestError } = await admin.rpc("renter_telegram_webhook_ingest", {
    p_payload: {
      organization_id: row.organization_id,
      telegram_id: String(telegramId),
      telegram_bot_id: String(row.telegram_bot_id ?? ""),
      update_id: String(updateId),
      is_start: isPrivateStart || isMemberJoin,
      blocked: isBlocked,
      allows_write: isBlocked ? false : isMemberJoin || isPrivateStart ? true : null,
    },
  });

  if (ingestError) {
    logEvent("renter_telegram_webhook_ingest_error", { code: ingestError.code ?? "rpc" });
    return new Response(null, { status: 500 });
  }

  return new Response("ok", { status: 200 });
});
