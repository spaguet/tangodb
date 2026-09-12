import { describe, expect, it } from "vitest";
import {
  allPackDaySlotsValid,
  ensureDayTimes,
  packDaySlotsHaveMixedHours,
  toPackDaySlots,
} from "./packDaySlots";

describe("packDaySlots", () => {
  it("fills missing weekdays from fallback without overwriting existing hours", () => {
    const next = ensureDayTimes(
      [1, 3],
      { 1: { timeStart: "09:00", timeEnd: "10:00" } },
      { timeStart: "18:00", timeEnd: "19:00" }
    );
    expect(next[1]).toEqual({ timeStart: "09:00", timeEnd: "10:00" });
    expect(next[3]).toEqual({ timeStart: "09:00", timeEnd: "10:00" });
  });

  it("builds sorted RPC day_slots and detects mixed hours", () => {
    const times = {
      5: { timeStart: "11:00", timeEnd: "12:00" },
      1: { timeStart: "09:00", timeEnd: "10:00" },
    };
    const slots = toPackDaySlots([5, 1], times);
    expect(slots).toEqual([
      { weekday: 1, time_start: "09:00", time_end: "10:00" },
      { weekday: 5, time_start: "11:00", time_end: "12:00" },
    ]);
    expect(packDaySlotsHaveMixedHours(slots)).toBe(true);
    expect(allPackDaySlotsValid([1, 5], times)).toBe(true);
  });
});
