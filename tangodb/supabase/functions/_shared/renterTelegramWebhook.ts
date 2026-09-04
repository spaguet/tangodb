export type TelegramUser = { id?: number };

export type TelegramMessage = {
  from?: TelegramUser;
  text?: string;
  chat?: { type?: string };
};

export type TelegramChatMemberUpdated = {
  from?: TelegramUser;
  chat?: { type?: string };
  new_chat_member?: { status?: string; user?: TelegramUser };
};

export type TelegramUpdate = {
  update_id?: number;
  message?: TelegramMessage;
  my_chat_member?: TelegramChatMemberUpdated;
};

export type WebhookIngestFlags = {
  telegramId: number | null;
  isStart: boolean;
  blocked: boolean;
  allowsWrite: boolean | null;
};

/** Private-chat context only — group/supergroup/channel updates are ignored. */
export function classifyTelegramWebhookUpdate(body: TelegramUpdate): WebhookIngestFlags {
  const message = body.message;
  const member = body.my_chat_member;

  if (!message && !member) {
    return { telegramId: null, isStart: false, blocked: false, allowsWrite: null };
  }

  const messagePrivate = message?.chat?.type === "private";
  const memberPrivate = member?.chat?.type === "private";

  const isPrivateStart =
    messagePrivate &&
    typeof message.text === "string" &&
    /^\/start(?:\s|$)/.test(message.text);

  const memberStatus = member?.new_chat_member?.status ?? "";
  const isPrivateMemberJoin =
    memberPrivate && (memberStatus === "member" || memberStatus === "restricted");
  const isPrivateBlocked =
    memberPrivate && (memberStatus === "kicked" || memberStatus === "left");

  const telegramId =
    messagePrivate && message?.from?.id != null
      ? message.from.id
      : memberPrivate
        ? member?.from?.id ?? member?.new_chat_member?.user?.id ?? null
        : null;

  if (telegramId == null || telegramId <= 0) {
    return { telegramId: null, isStart: false, blocked: false, allowsWrite: null };
  }

  const isStart = isPrivateStart || isPrivateMemberJoin;

  return {
    telegramId,
    isStart,
    blocked: isPrivateBlocked,
    allowsWrite: isPrivateBlocked ? false : isStart ? true : null,
  };
}
