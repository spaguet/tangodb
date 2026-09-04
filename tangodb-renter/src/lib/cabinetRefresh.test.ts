import { describe, expect, it } from "vitest";
import { formatRequestAge, needsCabinetPolling } from "./cabinetRefresh";

describe("needsCabinetPolling", () => {
  it("is false without wallet", () => {
    expect(needsCabinetPolling(null)).toBe(false);
  });

  it("is true when pending top-up exists", () => {
    expect(
      needsCabinetPolling({
        pending_topup: {
          id: "a",
          amount: 100,
          method: "cash",
          correlation_code: "TDB-TEST",
          created_at: new Date().toISOString(),
        },
        has_awaiting_payment: false,
      })
    ).toBe(true);
  });

  it("is true when awaiting_payment holds exist", () => {
    expect(
      needsCabinetPolling({
        pending_topup: null,
        has_awaiting_payment: true,
      })
    ).toBe(true);
  });
});

describe("formatRequestAge", () => {
  it("formats recent minutes in ru", () => {
    const created = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(formatRequestAge(created, "ru")).toBe("5 мин назад");
  });

  it("formats hours in en", () => {
    const created = new Date(Date.now() - 3 * 3600_000).toISOString();
    expect(formatRequestAge(created, "en")).toBe("3 h ago");
  });
});
