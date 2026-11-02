import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildNativeAuthReturnUrl,
  buildNativeLoginPageUrl,
  isNativeAuthHandoffSearch,
  parseNativeAuthReturn,
} from "./nativeAuthHandoff.ts";

describe("native auth handoff", () => {
  it("round-trips tokens in the query and keeps remember-me", () => {
    const url = buildNativeAuthReturnUrl(
      { accessToken: "access.jwt", refreshToken: "refresh.jwt" },
      false
    );
    assert.equal(url.startsWith("tangodb://auth-return?"), true);
    assert.equal(url.includes("#"), false);
    const parsed = parseNativeAuthReturn(url);
    assert.deepEqual(parsed, {
      accessToken: "access.jwt",
      refreshToken: "refresh.jwt",
      rememberMe: false,
    });
  });

  it("accepts a fragment when the query has no tokens", () => {
    const parsed = parseNativeAuthReturn(
      "tangodb://auth-return#access_token=aaa&refresh_token=bbb&remember=1"
    );
    assert.equal(parsed?.accessToken, "aaa");
    assert.equal(parsed?.refreshToken, "bbb");
    assert.equal(parsed?.rememberMe, true);
  });

  it("ignores https and other hosts", () => {
    assert.equal(
      parseNativeAuthReturn("https://tangodb.vercel.app/login?access_token=a&refresh_token=b"),
      null
    );
    assert.equal(
      parseNativeAuthReturn("tangodb://other?access_token=a&refresh_token=b"),
      null
    );
    assert.equal(parseNativeAuthReturn("tangodb://auth-return?access_token=only"), null);
  });

  it("builds the site login url and detects the handoff flag", () => {
    const login = buildNativeLoginPageUrl("https://tangodb.vercel.app/");
    assert.equal(login, "https://tangodb.vercel.app/login?native_handoff=1");
    assert.equal(isNativeAuthHandoffSearch("?native_handoff=1"), true);
    assert.equal(isNativeAuthHandoffSearch("native_handoff=0"), false);
  });
});
