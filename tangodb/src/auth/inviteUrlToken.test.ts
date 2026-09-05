import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeInviteToken, parseInviteTokenFromLocation } from "./inviteUrlToken.ts";

describe("parseInviteTokenFromLocation", () => {
  const oldToken = "TDB-INV-9bc4d9ae45e3d8b73d43f6d887ed7909";
  const newToken = "TDB-INV-a3c144400b6342072a7afceac7a069a4";

  it("reads #token= fragment", () => {
    assert.equal(parseInviteTokenFromLocation("", `#token=${oldToken}`), oldToken);
  });

  it("reads token when Telegram appends hash params", () => {
    assert.equal(
      parseInviteTokenFromLocation("", `#token=${oldToken}&tgWebAppVersion=8.0`),
      oldToken
    );
  });

  it("prefers URL token over stale boot stash", () => {
    assert.equal(
      parseInviteTokenFromLocation("", `#token=${newToken}`, oldToken),
      newToken
    );
  });

  it("falls back to boot stash after Telegram wipes the hash", () => {
    assert.equal(parseInviteTokenFromLocation("", "#tgWebAppData=aaa", oldToken), oldToken);
  });

  it("strips zero-width copy junk", () => {
    assert.equal(normalizeInviteToken(`\u200B${oldToken} `), oldToken);
  });
});
