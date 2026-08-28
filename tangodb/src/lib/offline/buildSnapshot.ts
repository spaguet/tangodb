import {
  SNAPSHOT_WINDOW_FUTURE_DAYS,
  SNAPSHOT_WINDOW_PAST_DAYS,
  OFFLINE_SCHEMA_VERSION,
} from "./constants";
import { stripOfflineContactPii } from "./stripContactPii";
import type { ShiftSnapshot, SnapshotLocation, SnapshotScheduleDate } from "./types";
import type { SubForDate } from "../../types";

function sanitizeSubForOffline(s: SubForDate): SubForDate {
  return {
    subId: s.subId,
    type: s.type,
    pairMonth: s.pairMonth,
    client1: s.client1,
    client2: s.client2,
    client3: s.client3,
    lessonsLeft: s.lessonsLeft,
    lessonsTotal: s.lessonsTotal,
    freezeUsed: s.freezeUsed,
    activationDate: s.activationDate,
    billingModel: s.billingModel,
    expiresAt: s.expiresAt ?? null,
    daysLeft: s.daysLeft,
    currentStatus: s.currentStatus,
    canFreeze: s.canFreeze,
    priceId: s.priceId,
    category: s.category,
  };
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function computeSnapshotWindow(todayStr: string): { start: string; end: string } {
  return {
    start: addDays(todayStr, -SNAPSHOT_WINDOW_PAST_DAYS),
    end: addDays(todayStr, SNAPSHOT_WINDOW_FUTURE_DAYS),
  };
}

export interface BuildSnapshotInput {
  userId: string;
  organizationId: string;
  timezone: string;
  todayStr: string;
  locations: SnapshotLocation[];
  scheduleDates: SnapshotScheduleDate[];
  getSubsForDate: (dateStr: string) => SubForDate[];
}

export function buildShiftSnapshot(input: BuildSnapshotInput): ShiftSnapshot {
  const { start, end } = computeSnapshotWindow(input.todayStr);
  const subsByDate: Record<string, SubForDate[]> = {};

  const datesInWindow = new Set<string>();
  for (const entry of input.scheduleDates) {
    if (entry.date >= start && entry.date <= end) {
      datesInWindow.add(entry.date);
    }
  }
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    datesInWindow.add(cursor);
  }

  for (const dateStr of datesInWindow) {
    const subs = input.getSubsForDate(dateStr);
    if (subs.length > 0) {
      subsByDate[dateStr] = subs.map(sanitizeSubForOffline);
    }
  }

  const filteredSchedule = input.scheduleDates.filter(
    (e) => e.date >= start && e.date <= end
  );

  return stripOfflineContactPii({
    schemaVersion: OFFLINE_SCHEMA_VERSION,
    userId: input.userId,
    organizationId: input.organizationId,
    syncedAt: new Date().toISOString(),
    timezone: input.timezone,
    windowStart: start,
    windowEnd: end,
    locations: input.locations.map((loc) => ({ id: loc.id, name: loc.name })),
    scheduleDates: filteredSchedule,
    subsByDate,
  });
}

export function scheduleDatesFromSnapshot(
  snapshot: ShiftSnapshot,
  locationId: string | null,
  month?: string
): SnapshotScheduleDate[] {
  return snapshot.scheduleDates.filter((entry) => {
    if (locationId != null && (entry.locationId ?? null) !== locationId) return false;
    if (month && !entry.date.startsWith(month)) return false;
    return true;
  });
}
