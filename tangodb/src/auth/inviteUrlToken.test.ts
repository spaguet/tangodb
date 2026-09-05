import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeInviteToken, parseInviteTokenFromLocation } from "./inviteUrlToken.ts";

describe("parseInviteTokenFromLocation", () => {
  const token = "TDB-INV-9bc4d9ae45e3d8b73d43f6d887ed7909";

  it("reads #token= fragment", () => {
    assert.equal(parseInviteTokenFromLocation("", `#token=${token}`), token);
  });

  it("reads token when Telegram appends hash params", () => {
    assert.equal(
      parseInviteTokenFromLocation("", `#token=${token}&tgWebAppVersion=8.0`),
      token
    );
  });

  it("prefers boot-script stash after Telegram wipes the hash", () => {
    assert.equal(parseInviteTokenFromLocation("", "#tgWebAppData=aaa", token), token);
  });

  it("strips zero-width copy junk", () => {
    assert.equal(normalizeInviteToken(`\u200B${token} `), token);
  });
});
