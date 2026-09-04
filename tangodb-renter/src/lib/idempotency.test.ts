import { describe, expect, it } from "vitest";
import { packScope } from "./idempotency";

describe("packScope", () => {
  it("sorts weekdays without mutating the input array", () => {
    const weekdays = [5, 1, 3];
    const scope = packScope("org", "loc", "2026-09-01", "2026-09-28", "18:00", "20:00", weekdays);
    expect(weekdays).toEqual([5, 1, 3]);
    expect(scope).toBe("org:loc:2026-09-01:2026-09-28:18:00:20:00:1,3,5");
  });

  it("produces the same scope regardless of weekday order", () => {
    const a = packScope("org", "loc", "2026-09-01", "2026-09-28", "18:00", "20:00", [3, 1, 5]);
    const b = packScope("org", "loc", "2026-09-01", "2026-09-28", "18:00", "20:00", [5, 3, 1]);
    expect(a).toBe(b);
  });
});
