import { reportClientError } from "../reportClientError";

export type OfflineMonitorEvent =
  | "snapshot_save_failed"
  | "snapshot_missing_offline"
  | "snapshot_expired"
  | "queue_enqueue"
  | "sync_started"
  | "sync_completed"
  | "sync_failed"
  | "conflict_detected"
  | "connection_restored"
  | "schema_migrated"
  | "namespace_cleared";

/** Minimal technical events — no PII, no queue payloads */
export function reportOfflineEvent(
  event: OfflineMonitorEvent,
  meta?: Record<string, string | number | boolean>
): void {
  reportClientError(new Error(`offline:${event}`), {
    area: "offline",
    action: event,
    meta,
  });
}
