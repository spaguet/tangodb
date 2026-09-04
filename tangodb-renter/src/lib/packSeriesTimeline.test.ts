import { describe, expect, it } from "vitest";
import { groupMineBookings, isPackOnHold, packHoldExpiresAt } from "./packSeriesTimeline";
import type { RentalItem } from "./types";

function rental(overrides: Partial<RentalItem> & Pick<RentalItem, "id" | "rental_date">): RentalItem {
  return {
    id: overrides.id,
    rental_series_id: overrides.rental_series_id ?? null,
    location_id: "loc-1",
    rental_date: overrides.rental_date,
    time_start: overrides.time_start ?? "18:00",
    time_end: overrides.time_end ?? "20:00",
    channel: "miniapp",
    lifecycle: overrides.lifecycle ?? "active",
    booking_status: "confirmed",
    hold_expires_at: overrides.hold_expires_at ?? null,
    prepay_amount: 500,
    remainder_amount: 500,
    debt_amount: 0,
    fixed_amount: 1000,
    currency: "RUB",
    prepay_charged_at: null,
    remainder_charged_at: null,
    series_status: overrides.series_status,
    series_hold_expires_at: overrides.series_hold_expires_at,
    series_occurrence_count: overrides.series_occurrence_count,
    series_occurrence_index: overrides.series_occurrence_index,
    can_cancel_pack: overrides.can_cancel_pack,
  };
}

describe("groupMineBookings", () => {
  it("groups pack occurrences into one row", () => {
    const items = [
      rental({
        id: "r1",
        rental_series_id: "s1",
        rental_date: "2026-09-07",
        series_occurrence_count: 3,
        series_occurrence_index: 1,
      }),
      rental({
        id: "r2",
        rental_series_id: "s1",
        rental_date: "2026-09-09",
        series_occurrence_count: 3,
        series_occurrence_index: 2,
      }),
      rental({ id: "r3", rental_date: "2026-09-10" }),
    ];

    const rows = groupMineBookings(items);
    expect(rows).toHaveLength(2);
    expect(rows[0].kind).toBe("pack");
    if (rows[0].kind === "pack") {
      expect(rows[0].rentals).toHaveLength(2);
      expect(rows[0].seriesId).toBe("s1");
    }
    expect(rows[1].kind).toBe("single");
  });
});

describe("pack hold helpers", () => {
  it("detects series-level hold", () => {
    const head = rental({
      id: "r1",
      rental_date: "2026-09-07",
      rental_series_id: "s1",
      lifecycle: "awaiting_payment",
      series_status: "awaiting_payment",
      series_hold_expires_at: "2026-09-08T12:00:00Z",
      series_occurrence_count: 12,
    });
    expect(isPackOnHold(head)).toBe(true);
    expect(packHoldExpiresAt(head)).toBe("2026-09-08T12:00:00Z");
  });
});
