/**
 * R4: drain renter_telegram_outbox via Bot API sendMessage (no parse_mode).
 * Called from renter-booking-worker after maintenance ticks.
 */

import {
  byteaToUint8Array,
  decryptTelegramBotToken,
  loadTelegramTokenKey,
} from "./telegramToken.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { logEvent } from "./supabase.ts";

const TELEGRAM_API = "https://api.telegram.org";
const DEFAULT_BATCH_SIZE = 10;
const GATE_WAIT_SECONDS = 300;
/** Must stay below claim lease (120s) so a hung fetch cannot outlive the lock. */
const LEASE_SECONDS = 120;
const FETCH_TIMEOUT_MS = 90_000;

export type OutboxRow = {
  id: string;
  organization_id: string;
  telegram_id: number;
  event_type: string;
  text: string;
  attempts: number;
  max_attempts: number;
  claim_token: string | null;
};

type BotSendConfig = {
  encrypted_bot_token: string | null;
  miniapp_url: string | null;
};

const FATAL_ERROR_CODES = new Set([
  "forbidden",
  "chat_not_found",
  "bot_cant_initiate",
  "user_deactivated",
  "peer_id_invalid",
]);

function isFatalTelegramError(status: number, description: string): boolean {
  if (status === 403) return true;
  if (status !== 400) return false;
  const d = description.toLowerCase();
  return (
    d.includes("bot can't initiate") ||
    d.includes("chat not found") ||
    d.includes("user is deactivated") ||
    d.includes("peer_id_invalid") ||
    d.includes("have no rights to send")
  );
}

function fatalErrorCode(status: number, description: string): string {
  const d = description.toLowerCase();
  if (status === 403 || d.includes("bot can't initiate")) return "bot_cant_initiate";
  if (d.includes("chat not found")) return "chat_not_found";
  if (d.includes("user is deactivated")) return "user_deactivated";
  if (d.includes("peer_id_invalid")) return "peer_id_invalid";
  return "forbidden";
}

async function completeOutbox(
  admin: SupabaseClient,
  id: string,
  outcome: string,
  claimToken: string | null,
  errorCode?: string | null,
  retrySeconds?: number | null
): Promise<void> {
  const { error } = await admin.rpc("complete_renter_telegram_outbox", {
    p_id: id,
    p_outcome: outcome,
    p_error_code: errorCode ?? null,
    p_retry_seconds: retrySeconds ?? null,
    p_claim_token: claimToken,
  });
  if (error) {
    logEvent("renter_outbox_complete_error", { id, message: error.message });
  }
}

async function loadBotConfig(
  admin: SupabaseClient,
  organizationId: string
): Promise<BotSendConfig | null> {
  const { data, error } = await admin.rpc("get_renter_telegram_bot_send_config", {
    p_org_id: organizationId,
  });
  if (error) {
    logEvent("renter_outbox_bot_config_error", { organizationId, message: error.message });
    return null;
  }
  const row = data as BotSendConfig | null;
  if (!row?.encrypted_bot_token) return null;
  return row;
}

async function sendTelegramMessage(
  token: string,
  chatId: number,
  text: string,
  miniappUrl: string | null
): Promise<{ ok: true } | { ok: false; fatal: boolean; code: string; retryAfter?: number }> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
  };
  if (miniappUrl) {
    body.reply_markup = {
      inline_keyboard: [[{ text: "Открыть кабинет", url: miniappUrl }]],
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      fatal: false,
      code: aborted ? "fetch_timeout" : "send_failed",
      retryAfter: 60,
    };
  } finally {
    clearTimeout(timeout);
  }

  if (res.ok) {
    return { ok: true };
  }

  let description = `HTTP ${res.status}`;
  let retryAfter: number | undefined;
  try {
    const payload = (await res.json()) as {
      description?: string;
      parameters?: { retry_after?: number };
    };
    if (payload.description) description = payload.description;
    if (res.status === 429 && payload.parameters?.retry_after) {
      retryAfter = payload.parameters.retry_after;
    }
  } catch {
    // ignore JSON parse failure
  }

  if (res.status === 429) {
    return { ok: false, fatal: false, code: "rate_limited", retryAfter: retryAfter ?? 60 };
  }

  const fatal = isFatalTelegramError(res.status, description);
  return {
    ok: false,
    fatal,
    code: fatal ? fatalErrorCode(res.status, description) : "send_failed",
    retryAfter,
  };
}

export type DrainResult = {
  claimed: number;
  sent: number;
  dead: number;
  waiting: number;
  skipped: number;
  batches: number;
};

export async function drainRenterTelegramOutbox(
  admin: SupabaseClient,
  options: {
    workerId: string;
    batchSize?: number;
    timeBudgetMs: number;
    startedAt?: number;
  }
): Promise<DrainResult> {
  const started = options.startedAt ?? Date.now();
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const tokenKey = await loadTelegramTokenKey();
  const botCache = new Map<string, { token: string; miniappUrl: string | null } | null>();

  const result: DrainResult = {
    claimed: 0,
    sent: 0,
    dead: 0,
    waiting: 0,
    skipped: 0,
    batches: 0,
  };

  while (Date.now() - started < options.timeBudgetMs) {
    const { data: rows, error: claimError } = await admin.rpc("claim_renter_telegram_outbox", {
      p_batch_size: batchSize,
      p_worker_id: options.workerId,
      p_lease_seconds: LEASE_SECONDS,
    });

    if (claimError) {
      logEvent("renter_outbox_claim_error", { message: claimError.message });
      break;
    }

    const batch = (rows ?? []) as OutboxRow[];
    if (batch.length === 0) break;

    result.batches += 1;
    result.claimed += batch.length;

    for (const row of batch) {
      const claimToken = row.claim_token;

      if (Date.now() - started >= options.timeBudgetMs) {
        await completeOutbox(admin, row.id, "gate_wait", claimToken, "time_budget", GATE_WAIT_SECONDS);
        result.waiting += 1;
        continue;
      }

      const { data: prepared, error: prepError } = await admin.rpc(
        "renter_telegram_outbox_prepare_send",
        { p_id: row.id }
      );

      if (prepError) {
        await completeOutbox(admin, row.id, "retry", claimToken, "prepare_failed", 60);
        continue;
      }

      const prep = prepared as {
        action?: string;
        reason?: string;
        telegram_id?: number;
        text?: string;
      } | null;

      if (prep?.action === "skip") {
        await completeOutbox(admin, row.id, "skipped", claimToken, prep.reason ?? "skip");
        result.skipped += 1;
        continue;
      }

      if (prep?.action === "gate_wait") {
        await completeOutbox(admin, row.id, "gate_wait", claimToken, prep.reason ?? "gate", GATE_WAIT_SECONDS);
        result.waiting += 1;
        continue;
      }

      if (prep?.action !== "send" || prep.telegram_id == null || !prep.text) {
        await completeOutbox(admin, row.id, "retry", claimToken, "prepare_invalid", 60);
        continue;
      }

      if (!botCache.has(row.organization_id)) {
        const cfg = await loadBotConfig(admin, row.organization_id);
        if (!cfg) {
          botCache.set(row.organization_id, null);
        } else if (!tokenKey) {
          botCache.set(row.organization_id, null);
        } else {
          const bytes = byteaToUint8Array(cfg.encrypted_bot_token);
          if (!bytes) {
            botCache.set(row.organization_id, null);
          } else {
            try {
              const token = await decryptTelegramBotToken(tokenKey, bytes);
              botCache.set(row.organization_id, {
                token,
                miniappUrl: cfg.miniapp_url,
              });
            } catch {
              botCache.set(row.organization_id, null);
            }
          }
        }
      }

      const bot = botCache.get(row.organization_id);
      if (!bot) {
        await completeOutbox(admin, row.id, "retry", claimToken, "bot_not_configured", 300);
        continue;
      }

      const sendResult = await sendTelegramMessage(
        bot.token,
        prep.telegram_id,
        prep.text,
        bot.miniappUrl
      );

      if (sendResult.ok) {
        await completeOutbox(admin, row.id, "sent", claimToken);
        result.sent += 1;
        continue;
      }

      if (sendResult.fatal || FATAL_ERROR_CODES.has(sendResult.code)) {
        await completeOutbox(admin, row.id, "dead", claimToken, sendResult.code);
        result.dead += 1;
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
        sendResult.retryAfter ?? 60
      );
    }
  }

  return result;
}
