import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isInviteTokenFormat, normalizeInviteToken } from "./inviteToken.ts";

Deno.test("normalizeInviteToken accepts canonical and messy copies", () => {
  const hex = "9bc4d9ae45e3d8b73d43f6d887ed7909";
  const canonical = `TDB-INV-${hex}`;
  assertEquals(normalizeInviteToken(canonical), canonical);
  assertEquals(normalizeInviteToken(`\u200B${canonical} \n`), canonical);
  assertEquals(normalizeInviteToken(`TDB-INV-${hex.toUpperCase()}`), canonical);
  assertEquals(normalizeInviteToken("TDB-INV-short"), null);
  assertEquals(normalizeInviteToken(`${canonical}&tgWebAppData=x`), null);
  assertEquals(isInviteTokenFormat(canonical), true);
});
