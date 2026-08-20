import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthProvider";
import { useOrganization } from "../organization/OrganizationProvider";
import { attendanceQueryKey } from "./useAttendance";
import { subscriptionsQueryKey } from "./useSubscriptions";
import { scheduleQueryKey } from "./useSchedule";
import { buildShiftSnapshot } from "../lib/offline/buildSnapshot";
import {
  clearOfflineData,
  countQueueOps,
  isSnapshotExpired,
  isSnapshotStale,
  loadOfflineQueue,
  loadShiftSnapshot,
  saveOfflineQueue,
  saveShiftSnapshot,
} from "../lib/offline/storage";
import { reportOfflineEvent } from "../lib/offline/monitoring";
import { useOfflineStore } from "../store/offline";
import type {
  AttendanceMarkStatus,
  OfflineAttendanceOperation,
  OfflineNamespace,
  OfflinePaymentDraft,
  ShiftSnapshot,
} from "../lib/offline/types";
import type { SubForDate } from "../types";
import { useOrgQueryScope } from "./useOrgQueryScope";

function useOfflineNamespace(): OfflineNamespace | null {
  const { session } = useAuth();
  const { organizationId } = useOrganization();
  const userId = session?.user?.id;
  if (!userId || !organizationId) return null;
  return { userId, organizationId };
}

export function useOfflineShiftLoader() {
  const ns = useOfflineNamespace();
  const setSnapshot = useOfflineStore((s) => s.setSnapshot);
  const setQueue = useOfflineStore((s) => s.setQueue);
  const setSnapshotLoading = useOfflineStore((s) => s.setSnapshotLoading);

  useEffect(() => {
    if (!ns) {
      setSnapshot(null);
      setQueue(null);
      return;
    }

    let cancelled = false;
    setSnapshotLoading(true);

    (async () => {
      try {
        const [snapshot, queue] = await Promise.all([
          loadShiftSnapshot(ns),
          loadOfflineQueue(ns),
        ]);
        if (cancelled) return;
        setSnapshot(snapshot);
        setQueue(queue);
      } catch (err) {
        reportOfflineEvent("snapshot_save_failed", {
          phase: "load",
        });
        if (!cancelled) {
          setSnapshot(null);
          setQueue(null);
        }
      } finally {
        if (!cancelled) setSnapshotLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ns?.userId, ns?.organizationId, setSnapshot, setQueue, setSnapshotLoading]);
}

export function useOfflineShiftMeta(connectionState: "online" | "offline" | "server-unreachable") {
  const snapshot = useOfflineStore((s) => s.snapshot);
  const queue = useOfflineStore((s) => s.queue);

  const isOfflineMode = connectionState !== "online";

  const counts = useMemo(
    () => (queue ? countQueueOps(queue) : { pending: 0, conflict: 0, failed: 0, drafts: 0 }),
    [queue]
  );

  const snapshotMeta = useMemo(() => {
    if (!snapshot) {
      return {
        hasSnapshot: false,
        isExpired: true,
        isStale: false,
        syncedAt: null as string | null,
        windowStart: null as string | null,
        windowEnd: null as string | null,
      };
    }
    return {
      hasSnapshot: true,
      isExpired: isSnapshotExpired(snapshot),
      isStale: isSnapshotStale(snapshot),
      syncedAt: snapshot.syncedAt,
      windowStart: snapshot.windowStart,
      windowEnd: snapshot.windowEnd,
    };
  }, [snapshot]);

  return { isOfflineMode, snapshot, queue, counts, snapshotMeta };
}

export function useCaptureShiftSnapshot() {
  const ns = useOfflineNamespace();
  const { settings } = useOrganization();
  const setSnapshot = useOfflineStore((s) => s.setSnapshot);

  return useCallback(
    async (input: {
      todayStr: string;
      locations: { id: string; name: string }[];
      scheduleDates: ShiftSnapshot["scheduleDates"];
      getSubsForDate: (dateStr: string) => SubForDate[];
    }) => {
      if (!ns) return;
      try {
        const snapshot = buildShiftSnapshot({
          userId: ns.userId,
          organizationId: ns.organizationId,
          timezone: settings?.timezone ?? "UTC",
          todayStr: input.todayStr,
          locations: input.locations,
          scheduleDates: input.scheduleDates,
          getSubsForDate: input.getSubsForDate,
        });
        await saveShiftSnapshot(snapshot);
        setSnapshot(snapshot);
      } catch {
        reportOfflineEvent("snapshot_save_failed", { phase: "save" });
      }
    },
    [ns, settings?.timezone, setSnapshot]
  );
}

export function useEnqueueOfflineAttendance() {
  const ns = useOfflineNamespace();
  const queue = useOfflineStore((s) => s.queue);
  const setQueue = useOfflineStore((s) => s.setQueue);

  return useCallback(
    async (params: {
      dateStr: string;
      subId: string;
      scheduleGroupId: string;
      disciplineId: string | null;
      expectedOldStatus: AttendanceMarkStatus | null;
      newStatus: AttendanceMarkStatus;
      snapshotLessonsLeft: number;
      snapshotFreezeUsed: number;
      clientDisplay: string;
    }) => {
      if (!ns) return { ok: false as const, error: "no_namespace" };

      const op: OfflineAttendanceOperation = {
        id: crypto.randomUUID(),
        kind: "group_attendance",
        status: "pending",
        createdAt: new Date().toISOString(),
        deviceCreatedAt: new Date().toISOString(),
        ...params,
      };

      const base = queue ?? {
        schemaVersion: 1,
        userId: ns.userId,
        organizationId: ns.organizationId,
        operations: [],
        paymentDrafts: [],
        updatedAt: new Date().toISOString(),
      };

      const next = {
        ...base,
        operations: [...base.operations, op],
      };
      await saveOfflineQueue(next);
      setQueue(next);
      reportOfflineEvent("queue_enqueue", { kind: "group_attendance" });
      return { ok: true as const, opId: op.id };
    },
    [ns, queue, setQueue]
  );
}

export function useSaveOfflinePaymentDraft() {
  const ns = useOfflineNamespace();
  const queue = useOfflineStore((s) => s.queue);
  const setQueue = useOfflineStore((s) => s.setQueue);

  return useCallback(
    async (draft: Omit<OfflinePaymentDraft, "id" | "createdAt">) => {
      if (!ns) return false;
      const entry: OfflinePaymentDraft = {
        ...draft,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      };
      const base = queue ?? {
        schemaVersion: 1,
        userId: ns.userId,
        organizationId: ns.organizationId,
        operations: [],
        paymentDrafts: [],
        updatedAt: new Date().toISOString(),
      };
      const next = { ...base, paymentDrafts: [...base.paymentDrafts, entry] };
      await saveOfflineQueue(next);
      setQueue(next);
      return true;
    },
    [ns, queue, setQueue]
  );
}

export function useClearOfflineNamespace() {
  const ns = useOfflineNamespace();
  const setSnapshot = useOfflineStore((s) => s.setSnapshot);
  const setQueue = useOfflineStore((s) => s.setQueue);

  return useCallback(async () => {
    if (!ns) return;
    await clearOfflineData(ns);
    setSnapshot(null);
    setQueue(null);
    reportOfflineEvent("namespace_cleared");
  }, [ns, setSnapshot, setQueue]);
}

export function useOfflineQueuePersistence() {
  const ns = useOfflineNamespace();
  const queue = useOfflineStore((s) => s.queue);
  const setQueue = useOfflineStore((s) => s.setQueue);

  const persistQueue = useCallback(
    async (nextOps: OfflineAttendanceOperation[], drafts?: OfflinePaymentDraft[]) => {
      if (!ns || !queue) return;
      const next = {
        ...queue,
        operations: nextOps,
        paymentDrafts: drafts ?? queue.paymentDrafts,
      };
      await saveOfflineQueue(next);
      setQueue(next);
    },
    [ns, queue, setQueue]
  );

  return { persistQueue };
}

export function useInvalidateAfterOfflineSync() {
  const queryClient = useQueryClient();
  const { withOrgId } = useOrgQueryScope();

  return useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: withOrgId(scheduleQueryKey) }),
      queryClient.invalidateQueries({ queryKey: withOrgId(attendanceQueryKey) }),
      queryClient.invalidateQueries({ queryKey: withOrgId(subscriptionsQueryKey) }),
    ]);
  }, [queryClient, withOrgId]);
}

export function useOfflineReconciliation() {
  const setReconciliationOpen = useOfflineStore((s) => s.setReconciliationOpen);
  const openReconciliation = useCallback(() => setReconciliationOpen(true), [setReconciliationOpen]);
  const closeReconciliation = useCallback(() => setReconciliationOpen(false), [setReconciliationOpen]);
  return { openReconciliation, closeReconciliation };
}

/** Call on logout / org switch — blocks stale queue from leaking */
export function useOfflineSecurityReset() {
  const clear = useClearOfflineNamespace();
  const prevNsRef = useRef<string | null>(null);
  const ns = useOfflineNamespace();
  const { session } = useAuth();

  useEffect(() => {
    const key = ns ? `${ns.userId}:${ns.organizationId}` : null;
    if (prevNsRef.current != null && prevNsRef.current !== key) {
      void clear();
    }
    prevNsRef.current = key;
  }, [ns?.userId, ns?.organizationId, clear]);

  useEffect(() => {
    if (!session) {
      void clear();
    }
  }, [session, clear]);
}
