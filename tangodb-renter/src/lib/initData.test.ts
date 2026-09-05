import { describe, expect, it } from "vitest";
import type { Session } from "@supabase/supabase-js";
import { sessionMatchesInitData } from "./auth";
import { parseTelegramUserIdFromInitData } from "./initData";

const ORG = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function initData(userId: number): string {
  const user = encodeURIComponent(JSON.stringify({ id: userId, first_name: "Test" }));
  return `user=${user}&start_param=${ORG}&auth_date=1700000000&hash=abc`;
}

function session(telegramId: string): Session {
  return {
    access_token: "token",
    refresh_token: "refresh",
    expires_in: 3600,
    token_type: "bearer",
    user: {
      id: "user-uuid",
      app_metadata: { actor: "renter", organization_id: ORG, telegram_id: telegramId },
      aud: "authenticated",
      created_at: "",
      role: "authenticated",
      updated_at: "",
    },
  };
}

describe("parseTelegramUserIdFromInitData", () => {
  it("reads positive integer user id", () => {
    expect(parseTelegramUserIdFromInitData(initData(12345))).toBe(12345);
  });

  it("rejects missing or invalid user", () => {
    expect(parseTelegramUserIdFromInitData("")).toBeNull();
    expect(parseTelegramUserIdFromInitData(`start_param=${ORG}`)).toBeNull();
    expect(
      parseTelegramUserIdFromInitData(
        `user=${encodeURIComponent(JSON.stringify({ id: 0 }))}&start_param=${ORG}`
      )
    ).toBeNull();
  });
});

describe("sessionMatchesInitData", () => {
  it("matches when telegram ids align", () => {
    const data = initData(999);
    expect(sessionMatchesInitData(session("999"), data)).toBe(true);
  });

  it("rejects another telegram account on the same origin", () => {
    const data = initData(111);
    expect(sessionMatchesInitData(session("222"), data)).toBe(false);
  });

  it("rejects session without telegram_id", () => {
    const data = initData(111);
    const bare = session("111");
    bare.user.app_metadata = { actor: "renter", organization_id: ORG };
    expect(sessionMatchesInitData(bare, data)).toBe(false);
  });
});
