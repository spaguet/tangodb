export type TelegramUser = { id?: number; username?: string };

export type TelegramMessage = {
  from?: TelegramUser;
  text?: string;
  chat?: { id?: number; type?: string; username?: string; title?: string };
};

export type TelegramChatMemberUpdated = {
  from?: TelegramUser;
  chat?: { id?: number; type?: string; username?: string; title?: string };
  new_chat_member?: { status?: string; user?: TelegramUser };
};

export type TelegramUpdate = {
  update_id?: number;
  message?: TelegramMessage;
  my_chat_member?: TelegramChatMemberUpdated;
};

export type ReceiptChatAction = "none" | "bind" | "unbind";

export type WebhookIngestFlags = {
  telegramId: number | null;
  isStart: boolean;
  blocked: boolean;
  allowsWrite: boolean | null;
  receiptChatId: number | null;
  receiptAction: ReceiptChatAction;
  receiptChatUsername: string | null;
  receiptChatTitle: string | null;
  fromUsername: string | null;
  chatType: string | null;
};

const EMPTY_FLAGS: WebhookIngestFlags = {
  telegramId: null,
  isStart: false,
  blocked: false,
  allowsWrite: null,
  receiptChatId: null,
  receiptAction: "none",
  receiptChatUsername: null,
  receiptChatTitle: null,
  fromUsername: null,
  chatType: null,
};

function usernameOf(user?: TelegramUser): string | null {
  return typeof user?.username === "string" && user.username.trim() !== ""
    ? user.username.replace(/^@/, "")
    : null;
}

/** Private Start/block as before; group/supergroup my_chat_member for receipt-chat bind only. */
export function classifyTelegramWebhookUpdate(body: TelegramUpdate): WebhookIngestFlags {
  const message = body.message;
  const member = body.my_chat_member;

  if (!message && !member) {
    return { ...EMPTY_FLAGS };
  }

  const flags: WebhookIngestFlags = { ...EMPTY_FLAGS };

  const messagePrivate = message?.chat?.type === "private";
  const memberPrivate = member?.chat?.type === "private";
  const memberGroup = member?.chat?.type === "group" || member?.chat?.type === "supergroup";

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

  if (telegramId != null && telegramId > 0) {
    const isStart = Boolean(isPrivateStart || isPrivateMemberJoin);
    flags.telegramId = telegramId;
    flags.isStart = isStart;
    flags.blocked = Boolean(isPrivateBlocked);
    flags.allowsWrite = isPrivateBlocked ? false : isStart ? true : null;
    flags.chatType = "private";
    flags.fromUsername = messagePrivate
      ? usernameOf(message?.from)
      : usernameOf(member?.from);
    if (isStart) {
      flags.receiptAction = "bind";
      flags.receiptChatId = telegramId;
    } else if (isPrivateBlocked) {
      flags.receiptAction = "unbind";
      flags.receiptChatId = telegramId;
    }
  }

  if (memberGroup) {
    const chatId = member?.chat?.id;
    if (chatId != null && chatId !== 0) {
      const joined =
        memberStatus === "member" ||
        memberStatus === "administrator" ||
        memberStatus === "restricted";
      const left = memberStatus === "kicked" || memberStatus === "left";
      flags.chatType = member?.chat?.type ?? "group";
      flags.receiptChatId = chatId;
      flags.receiptChatUsername =
        typeof member?.chat?.username === "string" && member.chat.username.trim() !== ""
          ? member.chat.username.replace(/^@/, "")
          : null;
      flags.receiptChatTitle =
        typeof member?.chat?.title === "string" && member.chat.title.trim() !== ""
          ? member.chat.title.trim().slice(0, 80)
          : null;
      if (joined) flags.receiptAction = "bind";
      else if (left) flags.receiptAction = "unbind";
    }
  }

  return flags;
}
