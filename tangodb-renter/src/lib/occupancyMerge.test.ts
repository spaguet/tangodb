import { describe, expect, it } from "vitest";
import { classifyInterval } from "./occupancyMerge";
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
  ];

  it("marks overlapping foreign slot as busy", () => {
    expect(classifyInterval("2026-09-01", "10:00", "10:30", busy, mine)).toBe("busy");
    expect(classifyInterval("2026-09-01", "11:30", "12:00", busy, mine)).toBe("busy");
  });

  it("marks non-overlapping slot as free", () => {
    expect(classifyInterval("2026-09-01", "12:00", "12:30", busy, mine)).toBe("free");
    expect(classifyInterval("2026-09-02", "10:00", "10:30", busy, mine)).toBe("free");
  });

  it("prefers mine over busy for own active rental", () => {
    expect(classifyInterval("2026-09-01", "14:00", "14:30", busy, mine)).toBe("mine");
  });

  it("classifies own hold with diagonal state", () => {
    expect(classifyInterval("2026-09-01", "18:00", "18:30", busy, mine)).toBe("mine_hold");
  });

  it("does not treat adjacent slots as overlap", () => {
    expect(classifyInterval("2026-09-01", "12:00", "12:30", busy, [])).toBe("free");
    expect(classifyInterval("2026-09-01", "09:30", "10:00", busy, [])).toBe("free");
  });
});
