import { describe, expect, it } from "vitest";
import { holdCountdown, holdCountdownExpired } from "./format";
import { computeServerOffsetMs, serverNowMs } from "./serverTime";

describe("serverTime", () => {
  it("computes offset from server_now", () => {
    const deviceNow = Date.now();
    const serverIso = new Date(deviceNow + 60_000).toISOString();
    const offset = computeServerOffsetMs(serverIso);
    expect(offset).toBeGreaterThan(59_000);
    expect(offset).toBeLessThan(61_000);
  });

  it("returns zero offset for invalid server_now", () => {
    expect(computeServerOffsetMs("not-a-date")).toBe(0);
    expect(computeServerOffsetMs(null)).toBe(0);
  });

  it("serverNowMs applies offset", () => {
    const base = Date.now();
    expect(serverNowMs(5_000)).toBeGreaterThanOrEqual(base + 4_999);
  });
});

describe("holdCountdown", () => {
  it("uses provided nowMs instead of device clock", () => {
    const expires = "2030-01-01T12:00:00.000Z";
    const now = new Date("2030-01-01T11:30:00.000Z").getTime();
    expect(holdCountdown(expires, now)).toBe("30m");
  });

  it("returns null when expired per server clock", () => {
    const expires = "2030-01-01T12:00:00.000Z";
    const now = new Date("2030-01-01T12:01:00.000Z").getTime();
    expect(holdCountdown(expires, now)).toBeNull();
    expect(holdCountdownExpired(expires, now)).toBe(true);
  });

  it("returns null without hold_expires_at", () => {
    expect(holdCountdown(null)).toBeNull();
  });
});
