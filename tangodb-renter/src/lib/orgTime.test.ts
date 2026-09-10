import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
  formatLongDate,
  formatWeekRangeLabel,
  isFreeSlotBookable,
  occupancyDaysFromWindow,
  occupancyWeeksFromWindow,
  orgIsoWeekday,
  resolveIsoDateFromSelect,
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

describe("orgIsoWeekday", () => {
  it("uses calendar Y-M-D, not Intl weekday names", () => {
    expect(orgIsoWeekday("Europe/Moscow", "2026-09-10")).toBe(4);
    expect(orgIsoWeekday("Asia/Bangkok", "2026-07-03")).toBe(5);
    expect(orgIsoWeekday("UTC", "2026-09-07")).toBe(1);
    expect(orgIsoWeekday("UTC", "2026-09-13")).toBe(7);
  });
});

describe("formatLongDate", () => {
  it("formats Russian as 03 июля 2026", () => {
    expect(formatLongDate("2026-07-03", "ru")).toBe("03 июля 2026");
  });

  it("formats English as 03 July 2026", () => {
    expect(formatLongDate("2026-07-03", "en")).toBe("03 July 2026");
  });
});

describe("resolveIsoDateFromSelect", () => {
  const days = ["2026-07-03", "2026-07-04", "2026-07-05"];

  it("keeps an ISO value that is in the list", () => {
    expect(resolveIsoDateFromSelect("2026-07-04", days, 0)).toBe("2026-07-04");
  });

  it("maps iOS localized option text via selectedIndex", () => {
    expect(resolveIsoDateFromSelect("03 июля 2026", days, 0)).toBe("2026-07-03");
    expect(resolveIsoDateFromSelect("4 июля 2026 г.", days, 1)).toBe("2026-07-04");
  });

  it("accepts ISO prefix from a datetime string", () => {
    expect(resolveIsoDateFromSelect("2026-07-05T00:00:00.000Z", days, 0)).toBe("2026-07-05");
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
