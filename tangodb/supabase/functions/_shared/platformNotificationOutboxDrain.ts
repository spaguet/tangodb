/**
 * S5a: drain platform_notification_outbox (email + Telegram).
 * Outbound only — never getUpdates / setWebhook (Detect is S5b).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { sendTransactionalEmail } from "./email.ts";
import {
  appendInboxLine,
  developerInboxUrl,
  developerSupportTicketUrl,
  retryDelaySeconds,
} from "./platformNotification.ts";
import { logEvent } from "./supabase.ts";
import {
  isTelegramBlockedError,
  sendTelegramMessagePlain,
  telegramBlockedErrorCode,
} from "./telegramSend.ts";

const DEFAULT_BATCH_SIZE = 10;
const LEASE_SECONDS = 120;

export type PlatformOutboxRow = {
  id: string;
  channel: "email" | "telegram";
  event_kind: string;
  source_type: string;
  source_id: string | null;
  payload: Record<string, unknown> | null;
  attempts: number;
  max_attempts: number;
  claim_token: string | null;
};

export type PlatformDrainResult = {
  claimed: number;
  sent: number;
  blocked: number;
  dead: number;
  retried: number;
  batches: number;
};

function payloadObject(row: PlatformOutboxRow): Record<string, unknown> {
  return row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
    ? row.payload
    : {};
}

function payloadString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

async function completeOutbox(
  admin: SupabaseClient,
  id: string,
  outcome: string,
  claimToken: string | null,
  errorCode?: string | null,
  retrySeconds?: number | null
): Promise<void> {
  const { error } = await admin.rpc("complete_platform_notification_outbox", {
    p_id: id,
    p_outcome: outcome,
    p_error_code: errorCode ?? null,
    p_retry_seconds: retrySeconds ?? null,
    p_claim_token: claimToken,
  });
  if (error) {
    logEvent("platform_outbox_complete_error", { id, message: error.message });
  }
}

async function loadChatId(admin: SupabaseClient): Promise<number | null> {
  const { data, error } = await admin
    .from("platform_notification_settings")
    .select("telegram_chat_id")
    .eq("id", 1)
    .maybeSingle();
  if (error) {
    logEvent("platform_outbox_settings_error", { message: error.message });
    return null;
  }
  const raw = (data as { telegram_chat_id?: number | string | null } | null)?.telegram_chat_id;
  const chatId = typeof raw === "string" ? Number(raw) : raw;
  if (typeof chatId !== "number" || !Number.isFinite(chatId) || chatId === 0) return null;
  return chatId;
}

async function markPurchaseEmailSent(admin: SupabaseClient, row: PlatformOutboxRow): Promise<void> {
  if (row.channel !== "email" || row.source_type !== "platform_purchase_request" || !row.source_id) {
    return;
  }
  const { error } = await admin
    .from("platform_purchase_requests")
    .update({ email_sent: true, updated_at: new Date().toISOString() })
    .eq("id", row.source_id);
  if (error) {
    logEvent("platform_outbox_email_sent_flag_error", { message: error.message });
  }
}

export async function drainPlatformNotificationOutbox(
  admin: SupabaseClient,
  options: {
    workerId: string;
    batchSize?: number;
    timeBudgetMs: number;
    startedAt?: number;
  }
): Promise<PlatformDrainResult> {
  const started = options.startedAt ?? Date.now();
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const inboxUrl = developerInboxUrl();
  const botToken = (Deno.env.get("PLATFORM_TELEGRAM_BOT_TOKEN") ?? "").trim();

  const result: PlatformDrainResult = {
    claimed: 0,
    sent: 0,
    blocked: 0,
    dead: 0,
    retried: 0,
    batches: 0,
  };

  while (Date.now() - started < options.timeBudgetMs) {
    const { data: rows, error: claimError } = await admin.rpc("claim_platform_notification_outbox", {
      p_batch_size: batchSize,
      p_worker_id: options.workerId,
      p_lease_seconds: LEASE_SECONDS,
    });

    if (claimError) {
      logEvent("platform_outbox_claim_error", { message: claimError.message });
      break;
    }

    const batch = (rows ?? []) as PlatformOutboxRow[];
    if (batch.length === 0) break;

    result.batches += 1;
    result.claimed += batch.length;

    for (const row of batch) {
      const claimToken = row.claim_token;
      const payload = payloadObject(row);

      if (Date.now() - started >= options.timeBudgetMs) {
        await completeOutbox(admin, row.id, "retry", claimToken, "time_budget", 15);
        result.retried += 1;
        continue;
      }

      if (row.channel === "telegram") {
        const chatId = await loadChatId(admin);
        if (!botToken || chatId == null) {
          await completeOutbox(admin, row.id, "blocked", claimToken, "config_missing");
          result.blocked += 1;
          continue;
        }

        const ticketInbox =
          row.source_type === "support_ticket" && row.source_id
            ? developerSupportTicketUrl(row.source_id)
            : null;
        const linkTarget = ticketInbox ?? inboxUrl;
        const text = appendInboxLine(payloadString(payload, "telegram_text"), linkTarget);
        if (!text) {
          await completeOutbox(admin, row.id, "dead", claimToken, "empty_payload");
          result.dead += 1;
          continue;
        }

        const sendResult = await sendTelegramMessagePlain(botToken, chatId, text);
        if (sendResult.ok) {
          await completeOutbox(admin, row.id, "sent", claimToken);
          result.sent += 1;
          continue;
        }

        if (sendResult.status != null && isTelegramBlockedError(sendResult.status, sendResult.description)) {
          await completeOutbox(
            admin,
            row.id,
            "blocked",
            claimToken,
            telegramBlockedErrorCode(sendResult.status, sendResult.description)
          );
          result.blocked += 1;
          continue;
        }

        if (row.attempts + 1 >= row.max_attempts) {
          await completeOutbox(admin, row.id, "dead", claimToken, sendResult.code);
          result.dead += 1;
          continue;
        }

        await completeOutbox(
          admin,
          row.id,
          "retry",
          claimToken,
          sendResult.code,
          retryDelaySeconds(row.attempts, sendResult.retryAfter)
        );
        result.retried += 1;
        continue;
      }

      if (row.channel === "email") {
        const envTo = (Deno.env.get("DEVELOPER_NOTIFY_EMAIL") ?? "").trim();
        const to = payloadString(payload, "email_to").trim() || envTo;
        const subject = payloadString(payload, "email_subject").trim() || "TangoDB notification";
        const text = appendInboxLine(
          payloadString(payload, "email_text") || payloadString(payload, "telegram_text"),
          inboxUrl
        );

        if (!to || !Deno.env.get("RESEND_API_KEY")?.trim()) {
          await completeOutbox(admin, row.id, "blocked", claimToken, "config_missing");
          result.blocked += 1;
          continue;
        }
        if (!text) {
          await completeOutbox(admin, row.id, "dead", claimToken, "empty_payload");
          result.dead += 1;
          continue;
        }

        const sent = await sendTransactionalEmail({ to, subject, text });
        if (sent) {
          await completeOutbox(admin, row.id, "sent", claimToken);
          await markPurchaseEmailSent(admin, row);
          result.sent += 1;
          continue;
        }

        if (row.attempts + 1 >= row.max_attempts) {
          await completeOutbox(admin, row.id, "dead", claimToken, "send_failed");
          result.dead += 1;
          continue;
        }

        await completeOutbox(
          admin,
          row.id,
          "retry",
          claimToken,
          "send_failed",
          retryDelaySeconds(row.attempts)
        );
        result.retried += 1;
        continue;
      }

      await completeOutbox(admin, row.id, "dead", claimToken, "unknown_channel");
      result.dead += 1;
    }
  }

  return result;
}
