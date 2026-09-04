import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
  formatWeekRangeLabel,
  isFreeSlotBookable,
  occupancyDaysFromWindow,
  occupancyWeeksFromWindow,
} from "./orgTime";

describe("occupancy weeks", () => {
  it("splits a 21-day Mon–Sun window into three weeks", () => {
    const from = "2026-08-31";
    const weeks = occupancyWeeksFromWindow(from);
    expect(weeks).toHaveLength(3);
    expect(weeks[0][0]).toBe("2026-08-31");
    expect(weeks[0][6]).toBe("2026-09-06");
    expect(weeks[1][0]).toBe("2026-09-07");
    expect(weeks[1][6]).toBe("2026-09-13");
    expect(weeks[2][0]).toBe("2026-09-14");
    expect(weeks[2][6]).toBe("2026-09-20");
    expect(occupancyDaysFromWindow(from)).toHaveLength(21);
    expect(addCalendarDays(from, 7)).toBe(weeks[1][0]);
  });

  it("formats a same-month week in ru without a browser-local Date", () => {
    expect(formatWeekRangeLabel("2026-09-07", "2026-09-13", "ru")).toMatch(/7–13/);
    expect(formatWeekRangeLabel("2026-09-07", "2026-09-13", "en")).toMatch(/7–13/);
  });

  it("formats a week that crosses months", () => {
    const label = formatWeekRangeLabel("2026-08-31", "2026-09-06", "ru");
    expect(label).toMatch(/31/);
    expect(label).toMatch(/6/);
  });
});

describe("isFreeSlotBookable", () => {
  const tz = "Europe/Moscow";

  it("rejects past calendar dates", () => {
    const serverNowMs = Date.parse("2026-09-03T12:00:00.000Z");
    expect(isFreeSlotBookable(tz, "2026-09-02", "18:00", serverNowMs)).toBe(false);
  });

  it("rejects same-day slots within one hour", () => {
    const serverNowMs = Date.parse("2026-09-03T09:30:00.000Z");
    expect(isFreeSlotBookable(tz, "2026-09-03", "12:00", serverNowMs)).toBe(false);
  });

  it("allows future dates regardless of hour", () => {
    const serverNowMs = Date.parse("2026-09-03T09:30:00.000Z");
    expect(isFreeSlotBookable(tz, "2026-09-05", "08:00", serverNowMs)).toBe(true);
  });
});
