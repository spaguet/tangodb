import { SYNC_LOCK_NAME } from "./constants";

const LOCK_STALE_MS = 60_000;

interface LockRecord {
  tabId: string;
  acquiredAt: number;
}

function getTabId(): string {
  if (typeof sessionStorage === "undefined") return "unknown";
  const key = "tangodb-offline-tab-id";
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
  }
  return id;
}

function readLock(): LockRecord | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(SYNC_LOCK_NAME);
    if (!raw) return null;
    return JSON.parse(raw) as LockRecord;
  } catch {
    return null;
  }
}

function writeLock(record: LockRecord): void {
  localStorage.setItem(SYNC_LOCK_NAME, JSON.stringify(record));
}

function clearLock(tabId: string): void {
  const existing = readLock();
  if (existing?.tabId === tabId) {
    localStorage.removeItem(SYNC_LOCK_NAME);
  }
}

/** Best-effort cross-tab lock — only one tab syncs at a time */
export async function withOfflineSyncLock<T>(fn: () => Promise<T>): Promise<T | null> {
  const tabId = getTabId();
  const now = Date.now();
  const existing = readLock();

  if (existing && existing.tabId !== tabId && now - existing.acquiredAt < LOCK_STALE_MS) {
    return null;
  }

  writeLock({ tabId, acquiredAt: now });

  if (typeof navigator !== "undefined" && "locks" in navigator) {
    try {
      return await navigator.locks.request(SYNC_LOCK_NAME, fn);
    } catch {
      // fall through
    }
  }

  try {
    return await fn();
  } finally {
    clearLock(tabId);
  }
}

export function isSyncLeader(): boolean {
  const existing = readLock();
  const tabId = getTabId();
  if (!existing) return true;
  if (existing.tabId === tabId) return true;
  return Date.now() - existing.acquiredAt >= LOCK_STALE_MS;
}
