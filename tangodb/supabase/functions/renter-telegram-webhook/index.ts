import { constantTimeEqual } from "../_shared/constantTime.ts";
import { createServiceClient, logEvent } from "../_shared/supabase.ts";
import {
  classifyTelegramWebhookUpdate,
  type TelegramUpdate,
} from "../_shared/renterTelegramWebhook.ts";

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

  let body: TelegramUpdate;
  try {
    body = (await req.json()) as TelegramUpdate;
  } catch {
    return new Response(null, { status: 400 });
  }

  const updateId = body.update_id;
  if (updateId == null || !Number.isFinite(updateId)) {
    return new Response("ok", { status: 200 });
  }

  const flags = classifyTelegramWebhookUpdate(body);
  if (flags.telegramId == null) {
    return new Response("ok", { status: 200 });
  }

  const { error: ingestError } = await admin.rpc("renter_telegram_webhook_ingest", {
    p_payload: {
      organization_id: row.organization_id,
      telegram_id: String(flags.telegramId),
      telegram_bot_id: String(row.telegram_bot_id ?? ""),
      update_id: String(updateId),
      is_start: flags.isStart,
      blocked: flags.blocked,
      allows_write: flags.allowsWrite,
    },
  });

  if (ingestError) {
    logEvent("renter_telegram_webhook_ingest_error", { code: ingestError.code ?? "rpc" });
    return new Response(null, { status: 500 });
  }

  return new Response("ok", { status: 200 });
});
