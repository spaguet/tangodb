import { create } from "zustand";
import type { ShiftSnapshot, OfflineQueue, OfflineAttendanceOperation, OfflinePaymentDraft } from "../lib/offline/types";

interface OfflineStoreState {
  snapshot: ShiftSnapshot | null;
  queue: OfflineQueue | null;
  reconciliationOpen: boolean;
  snapshotLoading: boolean;
  setSnapshot: (snapshot: ShiftSnapshot | null) => void;
  setQueue: (queue: OfflineQueue | null) => void;
  setReconciliationOpen: (open: boolean) => void;
  setSnapshotLoading: (loading: boolean) => void;
  patchQueueOps: (ops: OfflineAttendanceOperation[]) => void;
  patchPaymentDrafts: (drafts: OfflinePaymentDraft[]) => void;
}

export const useOfflineStore = create<OfflineStoreState>((set, get) => ({
  snapshot: null,
  queue: null,
  reconciliationOpen: false,
  snapshotLoading: false,
  setSnapshot: (snapshot) => set({ snapshot }),
  setQueue: (queue) => set({ queue }),
  setReconciliationOpen: (open) => set({ reconciliationOpen: open }),
  setSnapshotLoading: (loading) => set({ snapshotLoading: loading }),
  patchQueueOps: (operations) => {
    const q = get().queue;
    if (!q) return;
    set({ queue: { ...q, operations, updatedAt: new Date().toISOString() } });
  },
  patchPaymentDrafts: (paymentDrafts) => {
    const q = get().queue;
    if (!q) return;
    set({ queue: { ...q, paymentDrafts, updatedAt: new Date().toISOString() } });
  },
}));
