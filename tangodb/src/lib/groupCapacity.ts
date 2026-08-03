import type { GroupCapacitySnapshot, GroupWaitlistEntry, GroupWaitlistStatus } from "../types";

/** Collect unique client IDs from a subscription sale payload. */
export function collectSubscriptionClientIds(input: {
  clientId1: string;
  clientId2?: string;
  clientId3?: string;
  clientId4?: string;
}): string[] {
  const ids = [input.clientId1, input.clientId2, input.clientId3, input.clientId4].filter(
    (id): id is string => Boolean(id && id.trim())
  );
  return [...new Set(ids)];
}

/** Frozen subscriptions keep their seat — documented rule for UI copy. */
export const FROZEN_SUBSCRIPTION_KEEPS_SEAT = true as const;

export function parseMaxCapacityInput(
  raw: string
): { ok: true; value: number | null } | { ok: false } {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) return { ok: false };
  return { ok: true, value: parsed };
}

export function formatGroupOccupancy(
  snapshot: Pick<GroupCapacitySnapshot, "occupied" | "maxCapacity" | "hasLimit">,
  t: (key: string, params?: Record<string, string | number>) => string
): string | null {
  if (!snapshot.hasLimit || snapshot.maxCapacity == null) return null;
  return t("groupCapacity.occupiedOf", {
    occupied: snapshot.occupied,
    max: snapshot.maxCapacity,
  });
}

export function isGroupFull(snapshot: Pick<GroupCapacitySnapshot, "hasLimit" | "isFull">): boolean {
  return snapshot.hasLimit && snapshot.isFull;
}

export function forecastGroupOccupancy(
  snapshot: GroupCapacitySnapshot,
  additionalClients: string[]
): { occupiedAfter: number; wouldExceed: boolean } {
  if (!snapshot.hasLimit || snapshot.maxCapacity == null) {
    return { occupiedAfter: snapshot.occupied, wouldExceed: false };
  }

  const occupiedAfter = snapshot.occupied + additionalClients.length;
  return {
    occupiedAfter,
    wouldExceed: occupiedAfter > snapshot.maxCapacity,
  };
}

export function findCapacityConflict(
  snapshots: GroupCapacitySnapshot[],
  additionalClients: string[]
): GroupCapacitySnapshot | null {
  for (const snapshot of snapshots) {
    const { wouldExceed } = forecastGroupOccupancy(snapshot, additionalClients);
    if (wouldExceed) return snapshot;
  }
  return null;
}

export const ACTIVE_WAITLIST_STATUSES: GroupWaitlistStatus[] = ["waiting", "offered"];

export function isActiveWaitlistStatus(status: GroupWaitlistStatus): boolean {
  return ACTIVE_WAITLIST_STATUSES.includes(status);
}

export function sortWaitlistEntries(entries: GroupWaitlistEntry[]): GroupWaitlistEntry[] {
  return [...entries].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
  );
}

export function mapCapacitySnapshotRow(row: Record<string, unknown>): GroupCapacitySnapshot {
  return {
    classId: String(row.class_id),
    maxCapacity: row.max_capacity != null ? Number(row.max_capacity) : null,
    occupied: Number(row.occupied ?? 0),
    hasLimit: Boolean(row.has_limit),
    isFull: Boolean(row.is_full),
  };
}

export function mapWaitlistEntry(row: Record<string, unknown>): GroupWaitlistEntry {
  return {
    id: row.id as string,
    classId: row.class_id as string,
    clientId: row.client_id as string,
    status: row.status as GroupWaitlistStatus,
    comment: (row.comment as string) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
