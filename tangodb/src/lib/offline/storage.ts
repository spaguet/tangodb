import { OFFLINE_STORES, SNAPSHOT_MAX_AGE_MS } from "./constants";
import { idbDelete, idbGet, idbPut, migrateOfflineSchemaIfNeeded } from "./idb";
import type { OfflineNamespace, OfflineQueue, ShiftSnapshot } from "./types";
import { offlineNamespaceKey } from "./types";

export { offlineNamespaceKey } from "./types";

function snapshotKey(ns: OfflineNamespace): string {
  return offlineNamespaceKey(ns);
}

function emptyQueue(ns: OfflineNamespace): OfflineQueue {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    userId: ns.userId,
    organizationId: ns.organizationId,
    operations: [],
    paymentDrafts: [],
    updatedAt: now,
  };
}

export async function loadShiftSnapshot(ns: OfflineNamespace): Promise<ShiftSnapshot | null> {
  await migrateOfflineSchemaIfNeeded();
  const raw = await idbGet<ShiftSnapshot>(OFFLINE_STORES.snapshots, snapshotKey(ns));
  if (!raw || raw.schemaVersion !== 1) return null;
  if (raw.userId !== ns.userId || raw.organizationId !== ns.organizationId) return null;
  return raw;
}

export async function saveShiftSnapshot(snapshot: ShiftSnapshot): Promise<void> {
  await migrateOfflineSchemaIfNeeded();
  const key = offlineNamespaceKey({
    userId: snapshot.userId,
    organizationId: snapshot.organizationId,
  });
  await idbPut(OFFLINE_STORES.snapshots, key, snapshot);
}

export async function deleteShiftSnapshot(ns: OfflineNamespace): Promise<void> {
  await idbDelete(OFFLINE_STORES.snapshots, snapshotKey(ns));
}

export async function loadOfflineQueue(ns: OfflineNamespace): Promise<OfflineQueue> {
  await migrateOfflineSchemaIfNeeded();
  const raw = await idbGet<OfflineQueue>(OFFLINE_STORES.queues, snapshotKey(ns));
  if (!raw || raw.schemaVersion !== 1) return emptyQueue(ns);
  if (raw.userId !== ns.userId || raw.organizationId !== ns.organizationId) return emptyQueue(ns);
  return raw;
}

export async function saveOfflineQueue(queue: OfflineQueue): Promise<void> {
  await migrateOfflineSchemaIfNeeded();
  const key = offlineNamespaceKey({
    userId: queue.userId,
    organizationId: queue.organizationId,
  });
  await idbPut(OFFLINE_STORES.queues, key, { ...queue, updatedAt: new Date().toISOString() });
}

export async function clearOfflineData(ns: OfflineNamespace): Promise<void> {
  await deleteShiftSnapshot(ns);
  await idbDelete(OFFLINE_STORES.queues, snapshotKey(ns));
}

export function isSnapshotExpired(snapshot: ShiftSnapshot, nowMs = Date.now()): boolean {
  const syncedAt = Date.parse(snapshot.syncedAt);
  if (Number.isNaN(syncedAt)) return true;
  return nowMs - syncedAt > SNAPSHOT_MAX_AGE_MS;
}

export function isSnapshotStale(snapshot: ShiftSnapshot, nowMs = Date.now()): boolean {
  const syncedAt = Date.parse(snapshot.syncedAt);
  if (Number.isNaN(syncedAt)) return true;
  // Stale after 30 minutes — still usable but visually flagged
  return nowMs - syncedAt > 30 * 60 * 1000;
}

export function countQueueOps(queue: OfflineQueue): {
  pending: number;
  conflict: number;
  failed: number;
  drafts: number;
} {
  let pending = 0;
  let conflict = 0;
  let failed = 0;
  for (const op of queue.operations) {
    if (op.status === "pending" || op.status === "syncing") pending += 1;
    else if (op.status === "conflict") conflict += 1;
    else if (op.status === "failed") failed += 1;
  }
  return {
    pending,
    conflict,
    failed,
    drafts: queue.paymentDrafts.length,
  };
}
