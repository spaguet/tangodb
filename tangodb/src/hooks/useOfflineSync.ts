import { useCallback, useState } from "react";
import { syncOfflineAttendanceOp } from "../lib/offline/syncAttendance";
import { withOfflineSyncLock } from "../lib/offline/syncLock";
import { saveOfflineQueue } from "../lib/offline/storage";
import { reportOfflineEvent } from "../lib/offline/monitoring";
import { useOfflineStore } from "../store/offline";
import type { AttendanceMarkStatus, OfflineAttendanceOperation } from "../lib/offline/types";
import { useOfflineQueuePersistence, useInvalidateAfterOfflineSync } from "./useOfflineShift";
import { supabase } from "../lib/supabase";

export function useOfflineSyncEngine() {
  const queue = useOfflineStore((s) => s.queue);
  const setQueue = useOfflineStore((s) => s.setQueue);
  const { persistQueue } = useOfflineQueuePersistence();
  const invalidateCaches = useInvalidateAfterOfflineSync();
  const [syncing, setSyncing] = useState(false);

  const refreshServerStates = useCallback(async (ops: OfflineAttendanceOperation[]) => {
    const pending = ops.filter((o) => o.status === "pending" || o.status === "failed");
    if (pending.length === 0) return ops;

    const updated = [...ops];
    for (let i = 0; i < updated.length; i++) {
      const op = updated[i];
      if (op.status !== "pending" && op.status !== "failed" && op.status !== "conflict") continue;

      const { data } = await supabase
        .from("attendance")
        .select("status")
        .eq("date", op.dateStr)
        .eq("subscription_id", op.subId)
        .eq("schedule_group_id", op.scheduleGroupId)
        .maybeSingle();

      const serverStatus = (data?.status as AttendanceMarkStatus | undefined) ?? null;
      updated[i] = {
        ...op,
        serverOldStatus: serverStatus,
      };
    }
    return updated;
  }, []);

  const syncQueue = useCallback(async () => {
    if (!queue) return { synced: 0, conflicts: 0, failed: 0 };

    const result = await withOfflineSyncLock(async () => {
      setSyncing(true);
      reportOfflineEvent("sync_started");

      try {
        await invalidateCaches();

        let ops = await refreshServerStates(queue.operations);
        let synced = 0;
        let conflicts = 0;
        let failed = 0;

        const sorted = [...ops].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

        for (let i = 0; i < sorted.length; i++) {
          const op = sorted[i];
          if (op.status !== "pending" && op.status !== "failed") continue;

          sorted[i] = { ...op, status: "syncing" };
          await persistQueue(sorted);

          const syncResult = await syncOfflineAttendanceOp(op);

          if (syncResult.outcome === "applied") {
            sorted[i] = {
              ...op,
              status: "applied",
              appliedAt: new Date().toISOString(),
            };
            synced += 1;
          } else if (syncResult.outcome === "conflict") {
            sorted[i] = {
              ...op,
              status: "conflict",
              serverOldStatus: syncResult.serverOldStatus,
              serverLessonsLeft: syncResult.serverLessonsLeft,
            };
            conflicts += 1;
            reportOfflineEvent("conflict_detected");
          } else {
            sorted[i] = {
              ...op,
              status: "failed",
              lastError: syncResult.error,
            };
            failed += 1;
          }

          await persistQueue(sorted);
        }

        await invalidateCaches();
        reportOfflineEvent("sync_completed", { synced, conflicts, failed });

        return { synced, conflicts, failed };
      } catch {
        reportOfflineEvent("sync_failed");
        throw new Error("sync_failed");
      } finally {
        setSyncing(false);
      }
    });

    return result ?? { synced: 0, conflicts: 0, failed: 0 };
  }, [queue, persistQueue, refreshServerStates, invalidateCaches]);

  const resolveConflict = useCallback(
    async (
      opId: string,
      resolution: "apply_offline" | "keep_server" | "cancelled"
    ) => {
      if (!queue) return;

      const ops = queue.operations.map((op) => {
        if (op.id !== opId) return op;
        if (resolution === "cancelled" || resolution === "keep_server") {
          return { ...op, status: "cancelled" as const, conflictResolution: resolution };
        }
        return { ...op, status: "pending" as const, conflictResolution: resolution, expectedOldStatus: op.serverOldStatus ?? op.expectedOldStatus };
      });

      await persistQueue(ops);

      if (resolution === "apply_offline") {
        await syncQueue();
      }
    },
    [queue, persistQueue, syncQueue]
  );

  const dismissApplied = useCallback(async () => {
    if (!queue) return;
    const remaining = queue.operations.filter((o) => o.status !== "applied" && o.status !== "cancelled");
    const next = { ...queue, operations: remaining };
    await saveOfflineQueue(next);
    setQueue(next);
  }, [queue, setQueue]);

  return { syncQueue, resolveConflict, dismissApplied, syncing };
}
