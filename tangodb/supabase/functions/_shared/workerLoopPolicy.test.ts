import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_CALENDAR_SYNC_CHAIN_DEPTH,
  nextCalendarSyncChainDepth,
  parseChainDepth,
  shouldChainCalendarSync,
  shouldSkipCalendarSyncTick,
} from "./workerLoopPolicy.ts";

describe("calendar sync chain", () => {
  it("allows three follow-ups after the cron tick and then stops", () => {
    assert.equal(nextCalendarSyncChainDepth(0), 1);
    assert.equal(nextCalendarSyncChainDepth(1), 2);
    assert.equal(nextCalendarSyncChainDepth(2), 3);
    assert.equal(nextCalendarSyncChainDepth(MAX_CALENDAR_SYNC_CHAIN_DEPTH), null);
  });

  it("clamps a forged chain depth so it cannot reset or extend the chain", () => {
    assert.equal(parseChainDepth(undefined), 0);
    assert.equal(parseChainDepth(-4), 0);
    assert.equal(parseChainDepth(1.9), 1);
    assert.equal(parseChainDepth(99), MAX_CALENDAR_SYNC_CHAIN_DEPTH);
  });

  it("does not chain a tick that only failed or already drained", () => {
    assert.equal(
      shouldChainCalendarSync({ chainDepth: 0, shouldContinue: true, processed: 0 }),
      false
    );
    assert.equal(
      shouldChainCalendarSync({ chainDepth: 0, shouldContinue: false, processed: 10 }),
      false
    );
    assert.equal(
      shouldChainCalendarSync({ chainDepth: 0, shouldContinue: true, processed: 10 }),
      true
    );
    assert.equal(
      shouldChainCalendarSync({
        chainDepth: MAX_CALENDAR_SYNC_CHAIN_DEPTH,
        shouldContinue: true,
        processed: 10,
      }),
      false
    );
  });

  it("skips a new cron tick while a lease is held, and still runs a chain", () => {
    assert.equal(shouldSkipCalendarSyncTick(0, true), true);
    assert.equal(shouldSkipCalendarSyncTick(0, false), false);
    assert.equal(shouldSkipCalendarSyncTick(1, true), false);
  });
});
