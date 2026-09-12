import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getCrmSubscriptionGraceDaysLeft,
  isCrmSubscriptionTMinus7,
  isCrmSubscriptionWriteClosed,
} from "./crmSubscriptionState.ts";

const NOW = new Date("2026-09-12T12:00:00.000Z");

describe("crmSubscriptionState", () => {
  it("keeps writes open while active and period_end is in the future", () => {
    assert.equal(
      isCrmSubscriptionWriteClosed({
        licenseType: "subscription",
        subscriptionStatus: "active",
        currentPeriodEnd: "2026-09-12T12:00:01.000Z",
        now: NOW,
      }),
      false
    );
  });

  it("closes writes at the exact period_end boundary without waiting for cron", () => {
    assert.equal(
      isCrmSubscriptionWriteClosed({
        licenseType: "subscription",
        subscriptionStatus: "active",
        currentPeriodEnd: "2026-09-12T12:00:00.000Z",
        now: NOW,
      }),
      true
    );
    assert.equal(
      isCrmSubscriptionWriteClosed({
        licenseType: "subscription",
        subscriptionStatus: "active",
        currentPeriodEnd: "2026-09-12T11:59:59.000Z",
        now: NOW,
      }),
      true
    );
  });

  it("closes writes when status is not active or period_end is missing", () => {
    assert.equal(
      isCrmSubscriptionWriteClosed({
        licenseType: "subscription",
        subscriptionStatus: "past_due",
        currentPeriodEnd: "2026-09-20T12:00:00.000Z",
        now: NOW,
      }),
      true
    );
    assert.equal(
      isCrmSubscriptionWriteClosed({
        licenseType: "subscription",
        subscriptionStatus: "active",
        currentPeriodEnd: null,
        now: NOW,
      }),
      true
    );
    assert.equal(
      isCrmSubscriptionWriteClosed({
        licenseType: "lifetime",
        subscriptionStatus: "canceled",
        currentPeriodEnd: "2026-09-01T00:00:00.000Z",
        now: NOW,
      }),
      false
    );
  });

  it("does not treat suspended as part of the write-closed formula", () => {
    assert.equal(
      isCrmSubscriptionWriteClosed({
        licenseType: "subscription",
        subscriptionStatus: "canceled",
        currentPeriodEnd: "2026-09-01T00:00:00.000Z",
        now: NOW,
      }),
      true
    );
  });

  it("shows T−7 only while the period is still open and within 7 days", () => {
    assert.equal(
      isCrmSubscriptionTMinus7({
        licenseType: "subscription",
        subscriptionStatus: "active",
        currentPeriodEnd: "2026-09-19T12:00:00.000Z",
        now: NOW,
      }),
      true
    );
    assert.equal(
      isCrmSubscriptionTMinus7({
        licenseType: "subscription",
        subscriptionStatus: "active",
        currentPeriodEnd: "2026-09-19T12:00:01.000Z",
        now: NOW,
      }),
      false
    );
    assert.equal(
      isCrmSubscriptionTMinus7({
        licenseType: "subscription",
        subscriptionStatus: "active",
        currentPeriodEnd: "2026-09-12T12:00:00.000Z",
        now: NOW,
      }),
      false
    );
    assert.equal(
      isCrmSubscriptionTMinus7({
        licenseType: "subscription",
        subscriptionStatus: "past_due",
        currentPeriodEnd: "2026-09-15T12:00:00.000Z",
        now: NOW,
      }),
      false
    );
  });

  it("counts remaining grace days from period_end + 7 days", () => {
    assert.equal(getCrmSubscriptionGraceDaysLeft("2026-09-12T12:00:00.000Z", NOW), 7);
    assert.equal(getCrmSubscriptionGraceDaysLeft("2026-09-10T12:00:00.000Z", NOW), 5);
    assert.equal(getCrmSubscriptionGraceDaysLeft("2026-09-05T12:00:00.000Z", NOW), 0);
  });
});
