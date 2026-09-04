import { describe, expect, it } from "vitest";
import { validFromInWeekdays, weekdaysIncludingDate } from "./packWeekdays";

const TZ = "Europe/Moscow";

describe("packWeekdays", () => {
  it("adds Friday when validFrom moves to a Friday", () => {
    expect(weekdaysIncludingDate([1], TZ, "2026-09-04")).toEqual([1, 5]);
  });

  it("keeps weekdays unchanged when validFrom weekday is already selected", () => {
    expect(weekdaysIncludingDate([1, 3], TZ, "2026-09-07")).toEqual([1, 3]);
  });

  it("rejects submit when validFrom weekday is not selected", () => {
    expect(validFromInWeekdays(TZ, "2026-09-05", [1])).toBe(false);
    expect(validFromInWeekdays(TZ, "2026-09-07", [1])).toBe(true);
  });
});
