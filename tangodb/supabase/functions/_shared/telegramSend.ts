/**
 * Shared Bot API sendMessage (plain text, no parse_mode, no tenant AES).
 * Call sites: platform-notification-worker and renterTelegramOutboxDrain.
 */

const TELEGRAM_API = "https://api.telegram.org";
const FETCH_TIMEOUT_MS = 90_000;

export type TelegramSendOk = { ok: true };

export type TelegramSendFail = {
  ok: false;
  status: number | null;
  description: string;
  code: string;
  retryAfter?: number;
};

export type TelegramSendResult = TelegramSendOk | TelegramSendFail;

export function isTelegramBlockedError(status: number, description: string): boolean {
  if (status === 403) return true;
  const d = description.toLowerCase();
  return (
    d.includes("chat not found") ||
    d.includes("bot was kicked") ||
    d.includes("kicked") ||
    d.includes("have no rights to send") ||
    d.includes("bot is not a member")
  );
}

export function telegramBlockedErrorCode(status: number, description: string): string {
  const d = description.toLowerCase();
  if (d.includes("chat not found")) return "chat_not_found";
  if (d.includes("kicked") || d.includes("not a member")) return "kicked";
  if (status === 403) return "forbidden";
  return "forbidden";
}

export async function sendTelegramMessagePlain(
  token: string,
  chatId: number,
  text: string,
  extra?: Record<string, unknown>
): Promise<TelegramSendResult> {
  const { parse_mode: _ignoredParseMode, ...safeExtra } = extra ?? {};
  const body: Record<string, unknown> = {
    ...safeExtra,
    chat_id: chatId,
    text,
  };

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
      status: null,
      description: aborted ? "fetch_timeout" : "send_failed",
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
    return {
      ok: false,
      status: res.status,
      description,
      code: "rate_limited",
      retryAfter: retryAfter ?? 60,
    };
  }

  return {
    ok: false,
    status: res.status,
    description,
    code: isTelegramBlockedError(res.status, description)
      ? telegramBlockedErrorCode(res.status, description)
      : "send_failed",
    retryAfter,
  };
}
