import {
  OFFLINE_DB_NAME,
  OFFLINE_DB_VERSION,
  OFFLINE_SCHEMA_VERSION,
  OFFLINE_STORES,
} from "./constants";

let dbPromise: Promise<IDBDatabase> | null = null;

function openOfflineDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB unavailable"));
  }

  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OFFLINE_STORES.snapshots)) {
        db.createObjectStore(OFFLINE_STORES.snapshots);
      }
      if (!db.objectStoreNames.contains(OFFLINE_STORES.queues)) {
        db.createObjectStore(OFFLINE_STORES.queues);
      }
      if (!db.objectStoreNames.contains(OFFLINE_STORES.meta)) {
        db.createObjectStore(OFFLINE_STORES.meta);
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };

    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error("Failed to open offline database"));
    };
  });

  return dbPromise;
}

async function idbGet<T>(storeName: string, key: string): Promise<T | undefined> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error ?? new Error("idb get failed"));
  });
}

async function idbPut(storeName: string, key: string, value: unknown): Promise<void> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    store.put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("idb put failed"));
  });
}

async function idbDelete(storeName: string, key: string): Promise<void> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    store.delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("idb delete failed"));
  });
}

export async function readStoredSchemaVersion(): Promise<number | null> {
  try {
    const v = await idbGet<number>(OFFLINE_STORES.meta, "schemaVersion");
    return typeof v === "number" ? v : null;
  } catch {
    return null;
  }
}

export async function writeStoredSchemaVersion(version: number): Promise<void> {
  await idbPut(OFFLINE_STORES.meta, "schemaVersion", version);
}

export async function migrateOfflineSchemaIfNeeded(): Promise<void> {
  const stored = await readStoredSchemaVersion();
  if (stored === OFFLINE_SCHEMA_VERSION) return;
  if (stored != null && stored > OFFLINE_SCHEMA_VERSION) return;

  // v1: fresh install or unknown — no data migration needed yet
  await writeStoredSchemaVersion(OFFLINE_SCHEMA_VERSION);
}

export { idbGet, idbPut, idbDelete, openOfflineDb };
