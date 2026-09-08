import { describe, expect, it } from "vitest";
import {
  DEFAULT_RECURRING_PACK_WEEKS,
  packValidToFromWeekCount,
  RECURRING_PACK_WEEK_OPTIONS,
} from "./recurringPackWeeks";

describe("recurringPackWeeks", () => {
  it("defaults to 4 weeks", () => {
    expect(DEFAULT_RECURRING_PACK_WEEKS).toBe(4);
  });

  it("computes inclusive pack end dates", () => {
    expect(packValidToFromWeekCount("2026-09-01", 2)).toBe("2026-09-14");
    expect(packValidToFromWeekCount("2026-09-01", 3)).toBe("2026-09-21");
    expect(packValidToFromWeekCount("2026-09-01", 4)).toBe("2026-09-28");
  });

  it("allows only 2, 3, and 4 weeks", () => {
    expect(RECURRING_PACK_WEEK_OPTIONS).toEqual([2, 3, 4]);
  });
});
