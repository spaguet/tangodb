import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_CALENDAR_SYNC_CHAIN_DEPTH,
  MAX_MAINTENANCE_BATCHES,
  MAINTENANCE_TIME_BUDGET_MS,
  nextCalendarSyncChainDepth,
  parseChainDepth,
  shouldChainCalendarSync,
  shouldContinueMaintenance,
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

describe("renter booking maintenance loop", () => {
  it("stops when the batch made no progress", () => {
    assert.equal(
      shouldContinueMaintenance({
        batches: 1,
        processed: 4,
        failed: 0,
        progressed: false,
        elapsedMs: 100,
      }),
      false
    );
  });

  it("stops on failures with nothing processed, instead of retrying immediately", () => {
    assert.equal(
      shouldContinueMaintenance({
        batches: 1,
        processed: 0,
        failed: 2,
        progressed: false,
        elapsedMs: 100,
      }),
      false
    );
  });

  it("continues while renters actually leave the due set, within the caps", () => {
    assert.equal(
      shouldContinueMaintenance({
        batches: 1,
        processed: 20,
        failed: 0,
        progressed: true,
        elapsedMs: 100,
      }),
      true
    );
    assert.equal(
      shouldContinueMaintenance({
        batches: MAX_MAINTENANCE_BATCHES,
        processed: 20,
        failed: 0,
        progressed: true,
        elapsedMs: 100,
      }),
      false
    );
    assert.equal(
      shouldContinueMaintenance({
        batches: 1,
        processed: 20,
        failed: 0,
        progressed: true,
        elapsedMs: MAINTENANCE_TIME_BUDGET_MS,
      }),
      false
    );
  });

  it("stops on an empty claim", () => {
    assert.equal(
      shouldContinueMaintenance({
        batches: 1,
        processed: 0,
        failed: 0,
        progressed: false,
        elapsedMs: 20,
      }),
      false
    );
  });
});
