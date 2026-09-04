import {
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildDataCheckString,
  computeTelegramWebAppHash,
  extractVerifiedInitData,
  getNonPrivateLaunchError,
  validateAuthDate,
  validateStartParam,
  verifyTelegramWebAppHash,
} from "./telegramInitData.ts";

Deno.test("validateStartParam accepts UUID", () => {
  const id = "a0900000-0000-4000-8000-000000000001";
  assertEquals(validateStartParam(id), id);
  assertEquals(validateStartParam(""), null);
  assertEquals(validateStartParam("not-a-uuid"), null);
});

Deno.test("validateAuthDate window 10 min and future skew 60s", () => {
  const now = 1_700_000_000_000;
  assertEquals(validateAuthDate(Math.floor(now / 1000), now), true);
  assertEquals(validateAuthDate(Math.floor((now - 11 * 60_000) / 1000), now), false);
  assertEquals(validateAuthDate(Math.floor((now + 120_000) / 1000), now), false);
});

Deno.test("HMAC includes signature when present (Bot API 8.0+)", async () => {
  const botToken = "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11";
  const params = new URLSearchParams(
    "auth_date=1700000000&query_id=AAE&signature=abc&start_param=a0900000-0000-4000-8000-000000000001&user=%7B%22id%22%3A42%7D"
  );
  const withSig = await computeTelegramWebAppHash(botToken, buildDataCheckString(params));
  params.delete("signature");
  const withoutSig = await computeTelegramWebAppHash(botToken, buildDataCheckString(params));
  assertEquals(withSig === withoutSig, false);
});

Deno.test("verifyTelegramWebAppHash constant-time length gate", () => {
  assertEquals(verifyTelegramWebAppHash("abcd", "abcde"), false);
  assertEquals(verifyTelegramWebAppHash("abcd", "abce"), false);
});

Deno.test("extractVerifiedInitData ignores chat/receiver after HMAC", () => {
  const org = "a0900000-0000-4000-8000-000000000001";
  const nowSec = Math.floor(Date.now() / 1000);
  const params = new URLSearchParams(
    `auth_date=${nowSec}&chat=%7B%22id%22%3A-100%2C%22type%22%3A%22private%22%7D&receiver=%7B%22id%22%3A99%7D&start_param=${org}&user=%7B%22id%22%3A42%7D`
  );
  const parsed = extractVerifiedInitData(params, "deadbeef");
  assertEquals(parsed?.user.id, 42);
  assertEquals(parsed?.organizationId, org);
});

Deno.test("getNonPrivateLaunchError rejects group chat launch", () => {
  const params = new URLSearchParams(
    'chat={"id":-100,"type":"supergroup"}'
  );
  assertEquals(getNonPrivateLaunchError(params), "renter.auth.groupLaunchForbidden");
  params.set("chat", '{"id":1,"type":"private"}');
  assertEquals(getNonPrivateLaunchError(params), null);
  assertEquals(getNonPrivateLaunchError(new URLSearchParams()), null);
});
