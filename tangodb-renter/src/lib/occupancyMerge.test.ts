import { describe, expect, it } from "vitest";
import { classifyInterval, computeOccupancyDisplayRange, findOverlappingMine, mergeSlotStates, type SlotState } from "./occupancyMerge";
import type { BusySlot, MineSlot } from "./types";

describe("classifyInterval", () => {
  const busy: BusySlot[] = [
    { date: "2026-09-01", time_start: "10:00", time_end: "12:00" },
  ];

  const mine: MineSlot[] = [
    {
      id: "a",
      date: "2026-09-01",
      time_start: "14:00",
      time_end: "16:00",
      lifecycle: "active",
    },
    {
      id: "b",
      date: "2026-09-01",
      time_start: "18:00",
      time_end: "20:00",
      lifecycle: "awaiting_payment",
    },
    {
      id: "c",
      date: "2026-09-02",
      time_start: "10:00",
      time_end: "12:00",
      lifecycle: "debt",
    },
  ];

  it("marks overlapping foreign slot as busy", () => {
    expect(classifyInterval("2026-09-01", "10:00", "10:30", busy, mine)).toBe("busy");
    expect(classifyInterval("2026-09-01", "11:30", "12:00", busy, mine)).toBe("busy");
  });

  it("marks non-overlapping slot as free", () => {
    expect(classifyInterval("2026-09-01", "12:00", "12:30", busy, mine)).toBe("free");
    expect(classifyInterval("2026-09-03", "10:00", "10:30", busy, mine)).toBe("free");
  });

  it("prefers mine over busy for own active rental", () => {
    expect(classifyInterval("2026-09-01", "14:00", "14:30", busy, mine)).toBe("mine");
  });

  it("classifies own hold with diagonal state", () => {
    expect(classifyInterval("2026-09-01", "18:00", "18:30", busy, mine)).toBe("mine_hold");
  });

  it("classifies own debt lifecycle separately", () => {
    expect(classifyInterval("2026-09-02", "10:00", "10:30", busy, mine)).toBe("mine_debt");
  });

  it("does not treat adjacent slots as overlap", () => {
    expect(classifyInterval("2026-09-01", "12:00", "12:30", busy, [])).toBe("free");
    expect(classifyInterval("2026-09-01", "09:30", "10:00", busy, [])).toBe("free");
  });

  it("finds own booking on a later 30-min cell of the same interval", () => {
    expect(findOverlappingMine("2026-09-01", "14:30", mine)?.id).toBe("a");
    expect(findOverlappingMine("2026-09-01", "15:30", mine)?.id).toBe("a");
    expect(findOverlappingMine("2026-09-01", "16:00", mine)).toBeUndefined();
  });

  it("ignores cancelled own bookings so the cell is free", () => {
    const cancelledMine: MineSlot[] = [
      {
        id: "gone",
        date: "2026-09-01",
        time_start: "12:00",
        time_end: "13:00",
        lifecycle: "cancelled",
      },
    ];
    expect(classifyInterval("2026-09-01", "12:00", "12:30", [], cancelledMine)).toBe("free");
    expect(findOverlappingMine("2026-09-01", "12:00", cancelledMine)).toBeUndefined();
  });
});

describe("mergeSlotStates", () => {
  it("merges consecutive cells of the same state", () => {
    const starts = ["10:00", "10:30", "11:00", "11:30", "12:00"];
    const states = new Map<string, SlotState>([
      ["10:00", "busy"],
      ["10:30", "busy"],
      ["11:00", "busy"],
      ["11:30", "busy"],
      ["12:00", "free"],
    ]);
    expect(mergeSlotStates(starts, states)).toEqual([
      { timeStart: "10:00", timeEnd: "12:00", state: "busy" },
      { timeStart: "12:00", timeEnd: "12:30", state: "free" },
    ]);
  });

  it("keeps mine and busy as separate blocks", () => {
    const starts = ["10:00", "10:30", "11:00"];
    const states = new Map<string, SlotState>([
      ["10:00", "busy"],
      ["10:30", "mine"],
      ["11:00", "mine"],
    ]);
    expect(mergeSlotStates(starts, states)).toEqual([
      { timeStart: "10:00", timeEnd: "10:30", state: "busy" },
      { timeStart: "10:30", timeEnd: "11:30", state: "mine" },
    ]);
  });
});

describe("computeOccupancyDisplayRange", () => {
  it("uses CRM defaults when the week is empty", () => {
    expect(computeOccupancyDisplayRange([])).toEqual({ start: 7 * 60, end: 22 * 60 });
  });

  it("expands to cover early occupancy", () => {
    expect(
      computeOccupancyDisplayRange([{ time_start: "06:30", time_end: "08:00" }])
    ).toEqual({ start: 6 * 60, end: 22 * 60 });
  });

  it("expands to cover late occupancy", () => {
    expect(
      computeOccupancyDisplayRange([{ timeStart: "21:00", timeEnd: "23:00" }])
    ).toEqual({ start: 7 * 60, end: 23 * 60 });
  });
});
