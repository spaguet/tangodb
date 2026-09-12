/**
 * S5b: one-shot Detect helpers for the platform outbound bot.
 * Worker must not import this file (no getUpdates in cron).
 */

const TELEGRAM_API = "https://api.telegram.org";
const FETCH_TIMEOUT_MS = 15_000;

export type PlatformChatCandidate = {
  chatId: number;
  kind: "group" | "private";
  title: string | null;
  username: string | null;
  source: "my_chat_member" | "private_start" | "group_message";
};

type TelegramUser = { id?: number; username?: string; is_bot?: boolean };
type TelegramChat = { id?: number; type?: string; title?: string; username?: string };
type TelegramMessage = { text?: string; chat?: TelegramChat; from?: TelegramUser };
type TelegramChatMemberUpdated = {
  chat?: TelegramChat;
  new_chat_member?: { status?: string; user?: TelegramUser };
};

export type TelegramDetectUpdate = {
  update_id?: number;
  message?: TelegramMessage;
  my_chat_member?: TelegramChatMemberUpdated;
};

export type TelegramApiResult = {
  ok: boolean;
  result?: unknown;
  description?: string;
  error_code?: number;
};

function trimName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/^@/, "");
  return trimmed ? trimmed.slice(0, 80) : null;
}

function chatKind(type: string | undefined, chatId: number): "group" | "private" {
  if (type === "private" || chatId > 0) return "private";
  return "group";
}

function upsertCandidate(
  map: Map<number, PlatformChatCandidate>,
  next: PlatformChatCandidate
): void {
  const rank: Record<PlatformChatCandidate["source"], number> = {
    my_chat_member: 3,
    private_start: 2,
    group_message: 1,
  };
  const prev = map.get(next.chatId);
  if (!prev || rank[next.source] >= rank[prev.source]) {
    map.set(next.chatId, next);
  }
}

export function parsePlatformTelegramCandidates(updates: unknown[]): PlatformChatCandidate[] {
  const map = new Map<number, PlatformChatCandidate>();

  for (const raw of updates) {
    if (!raw || typeof raw !== "object") continue;
    const update = raw as TelegramDetectUpdate;
    const member = update.my_chat_member;
    const message = update.message;

    if (member?.chat?.id != null && member.chat.id !== 0) {
      const status = member.new_chat_member?.status ?? "";
      const joined = status === "member" || status === "administrator" || status === "restricted";
      const chatType = member.chat.type ?? "";
      const isGroup = chatType === "group" || chatType === "supergroup" || member.chat.id < 0;
      const isPrivate = chatType === "private" || member.chat.id > 0;
      if (joined && (isGroup || isPrivate)) {
        upsertCandidate(map, {
          chatId: member.chat.id,
          kind: chatKind(chatType, member.chat.id),
          title: trimName(member.chat.title),
          username: trimName(member.chat.username),
          source: isPrivate ? "private_start" : "my_chat_member",
        });
      }
    }

    const chatId = message?.chat?.id;
    if (chatId != null && chatId !== 0) {
      const text = typeof message?.text === "string" ? message.text : "";
      const isPrivate = message?.chat?.type === "private" || chatId > 0;
      const isStart = isPrivate && /^\/start(?:\s|$)/.test(text);
      if (isStart) {
        upsertCandidate(map, {
          chatId,
          kind: "private",
          title: trimName(message?.from?.username),
          username: trimName(message?.from?.username),
          source: "private_start",
        });
      } else if (message?.chat?.type === "group" || message?.chat?.type === "supergroup" || chatId < 0) {
        upsertCandidate(map, {
          chatId,
          kind: "group",
          title: trimName(message?.chat?.title),
          username: trimName(message?.chat?.username),
          source: "group_message",
        });
      }
    }
  }

  return [...map.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "group" ? -1 : 1;
    return a.chatId < b.chatId ? -1 : 1;
  });
}

export async function telegramBotApi(
  token: string,
  method: string,
  body?: Record<string, unknown>
): Promise<TelegramApiResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : "{}",
      signal: controller.signal,
    });
    try {
      return (await res.json()) as TelegramApiResult;
    } catch {
      return { ok: false, description: "telegram_http", error_code: res.status };
    }
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return { ok: false, description: aborted ? "fetch_timeout" : "send_failed" };
  } finally {
    clearTimeout(timeout);
  }
}

export function webhookUrlOf(info: unknown): string | null {
  if (!info || typeof info !== "object") return null;
  const url = (info as { url?: unknown }).url;
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  return trimmed ? trimmed : null;
}
