import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyTelegramWebhookUpdate } from "./renterTelegramWebhook.ts";

Deno.test("private /start sets bot started", () => {
  const flags = classifyTelegramWebhookUpdate({
    update_id: 1,
    message: {
      from: { id: 42, username: "owner" },
      chat: { type: "private" },
      text: "/start",
    },
  });
  assertEquals(flags.telegramId, 42);
  assertEquals(flags.isStart, true);
  assertEquals(flags.blocked, false);
  assertEquals(flags.allowsWrite, true);
  assertEquals(flags.receiptAction, "bind");
  assertEquals(flags.receiptChatId, 42);
  assertEquals(flags.fromUsername, "owner");
});

Deno.test("private my_chat_member member counts as started", () => {
  const flags = classifyTelegramWebhookUpdate({
    update_id: 2,
    my_chat_member: {
      from: { id: 55 },
      chat: { type: "private" },
      new_chat_member: { status: "member", user: { id: 55 } },
    },
  });
  assertEquals(flags.telegramId, 55);
  assertEquals(flags.isStart, true);
  assertEquals(flags.receiptAction, "bind");
  assertEquals(flags.receiptChatId, 55);
});

Deno.test("group my_chat_member binds receipt chat without renter dialog", () => {
  const flags = classifyTelegramWebhookUpdate({
    update_id: 3,
    my_chat_member: {
      from: { id: 77 },
      chat: { type: "supergroup", id: -100123456, username: "studiohall", title: "Studio hall" },
      new_chat_member: { status: "member", user: { id: 999 } },
    },
  });
  assertEquals(flags.telegramId, null);
  assertEquals(flags.isStart, false);
  assertEquals(flags.receiptAction, "bind");
  assertEquals(flags.receiptChatId, -100123456);
  assertEquals(flags.receiptChatUsername, "studiohall");
  assertEquals(flags.receiptChatTitle, "Studio hall");
});

Deno.test("group kick unbinds receipt chat", () => {
  const flags = classifyTelegramWebhookUpdate({
    update_id: 6,
    my_chat_member: {
      from: { id: 77 },
      chat: { type: "group", id: -4123 },
      new_chat_member: { status: "kicked", user: { id: 999 } },
    },
  });
  assertEquals(flags.telegramId, null);
  assertEquals(flags.receiptAction, "unbind");
  assertEquals(flags.receiptChatId, -4123);
});

Deno.test("group /start message is ignored", () => {
  const flags = classifyTelegramWebhookUpdate({
    update_id: 4,
    message: {
      from: { id: 88 },
      chat: { type: "group" },
      text: "/start",
    },
  });
  assertEquals(flags.telegramId, null);
  assertEquals(flags.receiptAction, "none");
});

Deno.test("private blocked clears allows_write", () => {
  const flags = classifyTelegramWebhookUpdate({
    update_id: 5,
    my_chat_member: {
      from: { id: 66 },
      chat: { type: "private" },
      new_chat_member: { status: "kicked", user: { id: 66 } },
    },
  });
  assertEquals(flags.telegramId, 66);
  assertEquals(flags.blocked, true);
  assertEquals(flags.allowsWrite, false);
  assertEquals(flags.receiptAction, "unbind");
  assertEquals(flags.receiptChatId, 66);
});
