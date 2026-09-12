import { describe, expect, it } from "vitest";
import { mineCancelKind, mineCancelRetainsPrepay } from "./mineCancel";
import { orgZonedDateTimeMs } from "./orgTime";

const tz = "Europe/Moscow";

describe("mineCancelKind", () => {
  it("deletes unpaid holds", () => {
    expect(
      mineCancelKind(
        { lifecycle: "awaiting_payment", date: "2026-09-14", time_start: "14:00" },
        tz,
        Date.parse("2026-09-14T12:00:00.000Z")
      )
    ).toBe("delete_hold");
  });

  it("cancels paid bookings before start", () => {
    const start = orgZonedDateTimeMs(tz, "2026-09-14", "14:00");
    expect(
      mineCancelKind(
        { lifecycle: "active", date: "2026-09-14", time_start: "14:00" },
        tz,
        start - 60 * 60 * 1000
      )
    ).toBe("cancel_occurrence");
  });

  it("blocks paid cancel after start", () => {
    const start = orgZonedDateTimeMs(tz, "2026-09-14", "14:00");
    expect(
      mineCancelKind(
        { lifecycle: "prepaid_charged", date: "2026-09-14", time_start: "14:00" },
        tz,
        start
      )
    ).toBe("none");
  });

  it("does not cancel debt or settled slots", () => {
    expect(
      mineCancelKind(
        { lifecycle: "debt", date: "2026-09-14", time_start: "14:00" },
        tz,
        Date.parse("2026-09-10T08:00:00.000Z")
      )
    ).toBe("none");
  });
});

describe("mineCancelRetainsPrepay", () => {
  it("refunds when more than 24 hours remain", () => {
    const start = orgZonedDateTimeMs(tz, "2026-09-14", "14:00");
    expect(
      mineCancelRetainsPrepay(
        { lifecycle: "active", date: "2026-09-14", time_start: "14:00" },
        tz,
        start - 25 * 60 * 60 * 1000
      )
    ).toBe(false);
  });

  it("retains at the 24-hour boundary", () => {
    const start = orgZonedDateTimeMs(tz, "2026-09-14", "14:00");
    expect(
      mineCancelRetainsPrepay(
        { lifecycle: "prepaid_charged", date: "2026-09-14", time_start: "14:00" },
        tz,
        start - 24 * 60 * 60 * 1000
      )
    ).toBe(true);
  });
});
