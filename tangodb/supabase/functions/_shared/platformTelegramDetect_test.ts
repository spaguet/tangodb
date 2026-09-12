import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parsePlatformTelegramCandidates, webhookUrlOf } from "./platformTelegramDetect.ts";

Deno.test("Detect prefers group my_chat_member and private /start", () => {
  const candidates = parsePlatformTelegramCandidates([
    {
      my_chat_member: {
        chat: { id: -100123, type: "supergroup", title: "Dev alerts" },
        new_chat_member: { status: "member" },
      },
    },
    {
      message: {
        text: "/start",
        chat: { id: 4242, type: "private" },
        from: { username: "omow" },
      },
    },
    {
      message: {
        text: "hello",
        chat: { id: -100123, type: "supergroup", title: "Dev alerts" },
      },
    },
  ]);
  assertEquals(candidates.length, 2);
  assertEquals(candidates[0].chatId, -100123);
  assertEquals(candidates[0].kind, "group");
  assertEquals(candidates[0].source, "my_chat_member");
  assertEquals(candidates[1].chatId, 4242);
  assertEquals(candidates[1].source, "private_start");
});

Deno.test("webhookUrlOf treats empty url as unset", () => {
  assertEquals(webhookUrlOf({ url: "" }), null);
  assertEquals(webhookUrlOf({ url: "https://example/hook" }), "https://example/hook");
});

Deno.test("platform-notification-worker still must not call getUpdates or setWebhook", async () => {
  const worker = await Deno.readTextFile(
    new URL("../platform-notification-worker/index.ts", import.meta.url)
  );
  const drain = await Deno.readTextFile(
    new URL("./platformNotificationOutboxDrain.ts", import.meta.url)
  );
  const src = `${worker}\n${drain}`;
  assertEquals(/["']getUpdates["']/.test(src), false);
  assertEquals(/["']setWebhook["']/.test(src), false);
});

Deno.test("Detect helper lives outside the worker", async () => {
  const detect = await Deno.readTextFile(
    new URL("../dev-console-platform-bot/index.ts", import.meta.url)
  );
  assertEquals(/["']getUpdates["']/.test(detect), true);
  assertEquals(/["']setWebhook["']/.test(detect), false);
});
