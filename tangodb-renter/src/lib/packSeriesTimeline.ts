import type { RentalItem } from "./types";

export type MinePackRow = {
  kind: "pack";
  seriesId: string;
  rentals: RentalItem[];
  head: RentalItem;
};

export type MineSingleRow = {
  kind: "single";
  rental: RentalItem;
};

export type MineBookingRow = MinePackRow | MineSingleRow;

function rentalSortKey(r: RentalItem): string {
  return `${r.rental_date}T${r.time_start}`;
}

export function groupMineBookings(items: RentalItem[]): MineBookingRow[] {
  const seenSeries = new Set<string>();
  const rows: MineBookingRow[] = [];

  for (const item of items) {
    const seriesId = item.rental_series_id;
    const packSize = item.series_occurrence_count ?? 0;
    if (seriesId && packSize > 1) {
      if (seenSeries.has(seriesId)) continue;
      seenSeries.add(seriesId);
      const rentals = items
        .filter((r) => r.rental_series_id === seriesId)
        .sort((a, b) => rentalSortKey(a).localeCompare(rentalSortKey(b)));
      rows.push({
        kind: "pack",
        seriesId,
        rentals,
        head: rentals[0] ?? item,
      });
      continue;
    }
    rows.push({ kind: "single", rental: item });
  }

  return rows;
}

export function isPackOnHold(head: RentalItem): boolean {
  if (head.series_status === "awaiting_payment") return true;
  return (
    (head.series_occurrence_count ?? 0) > 1 && head.lifecycle === "awaiting_payment"
  );
}

export function packHoldExpiresAt(head: RentalItem): string | null {
  return head.series_hold_expires_at ?? head.hold_expires_at;
}
