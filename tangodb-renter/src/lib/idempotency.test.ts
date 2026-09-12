import { describe, expect, it } from "vitest";
import { packScope } from "./idempotency";

describe("packScope", () => {
  it("sorts day slots without mutating the input array", () => {
    const slots = [
      { weekday: 5, time_start: "11:00", time_end: "12:00" },
      { weekday: 1, time_start: "09:00", time_end: "10:00" },
    ];
    const scope = packScope("org", "loc", "2026-09-01", "2026-09-28", slots);
    expect(slots[0].weekday).toBe(5);
    expect(scope).toBe("org:loc:2026-09-01:2026-09-28:1:09:00-10:00,5:11:00-12:00");
  });

  it("produces the same scope regardless of slot order", () => {
    const a = packScope("org", "loc", "2026-09-01", "2026-09-28", [
      { weekday: 3, time_start: "10:00", time_end: "11:00" },
      { weekday: 1, time_start: "09:00", time_end: "10:00" },
    ]);
    const b = packScope("org", "loc", "2026-09-01", "2026-09-28", [
      { weekday: 1, time_start: "09:00", time_end: "10:00" },
      { weekday: 3, time_start: "10:00", time_end: "11:00" },
    ]);
    expect(a).toBe(b);
  });
});
