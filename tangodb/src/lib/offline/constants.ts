/** IndexedDB database name — separate from TanStack Query memory cache */
export const OFFLINE_DB_NAME = "tangodb-offline";

/** Bump when store layout changes; migration runs in idb.ts */
export const OFFLINE_DB_VERSION = 1;

/** Bump when snapshot/queue record shape changes */
export const OFFLINE_SCHEMA_VERSION = 1;

/** Discard snapshots older than this (72 h) — evening shift + next day buffer */
export const SNAPSHOT_MAX_AGE_MS = 72 * 60 * 60 * 1000;

/** Days before today included in shift snapshot */
export const SNAPSHOT_WINDOW_PAST_DAYS = 3;

/** Days after today included in shift snapshot */
export const SNAPSHOT_WINDOW_FUTURE_DAYS = 7;

export const SYNC_LOCK_NAME = "tangodb-offline-sync";

export const OFFLINE_MARK_SCOPE = "offline_mark_attendance";

export const OFFLINE_STORES = {
  snapshots: "snapshots",
  queues: "queues",
  meta: "meta",
} as const;
