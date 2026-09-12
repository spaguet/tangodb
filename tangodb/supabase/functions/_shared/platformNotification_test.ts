import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { appendInboxLine, retryDelaySeconds } from "./platformNotification.ts";
import { isTelegramBlockedError, telegramBlockedErrorCode } from "./telegramSend.ts";

Deno.test("appendInboxLine keeps message within 4096", () => {
  const inbox = "https://tangodb-dev-console.vercel.app/inbox";
  const long = "x".repeat(5000);
  const out = appendInboxLine(long, inbox);
  assertEquals(out.length <= 4096, true);
  assertEquals(out.endsWith(`Inbox: ${inbox}`), true);
});

Deno.test("appendInboxLine omits line when url missing", () => {
  assertEquals(appendInboxLine("hello", null), "hello");
});

Deno.test("retryDelaySeconds honors retry_after with floor", () => {
  const delay = retryDelaySeconds(0, 120);
  assertEquals(delay >= 120, true);
  assertEquals(delay <= 126, true);
});

Deno.test("403 / chat not found / kicked are blocked, not generic send_failed", () => {
  assertEquals(isTelegramBlockedError(403, "Forbidden: bot was kicked from the group chat"), true);
  assertEquals(telegramBlockedErrorCode(403, "Forbidden: bot was kicked from the group chat"), "kicked");
  assertEquals(isTelegramBlockedError(400, "Bad Request: chat not found"), true);
  assertEquals(telegramBlockedErrorCode(400, "Bad Request: chat not found"), "chat_not_found");
  assertEquals(isTelegramBlockedError(500, "internal"), false);
});

Deno.test("platform-notification-worker never calls getUpdates or setWebhook", async () => {
  const worker = await Deno.readTextFile(
    new URL("../platform-notification-worker/index.ts", import.meta.url)
  );
  const drain = await Deno.readTextFile(
    new URL("./platformNotificationOutboxDrain.ts", import.meta.url)
  );
  const src = `${worker}\n${drain}`;
  assertEquals(/\/getUpdates/.test(src), false);
  assertEquals(/\/setWebhook/.test(src), false);
});
