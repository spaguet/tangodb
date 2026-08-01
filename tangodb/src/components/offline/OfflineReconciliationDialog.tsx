import { useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { AlertTriangle, CheckCircle2, Loader2, X } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";
import { useOfflineStore } from "../../store/offline";
import { useOfflineSyncEngine } from "../../hooks/useOfflineSync";
import { attendanceStatusLabelKey } from "../../lib/offline/mergeSubs";
import type { AttendanceMarkStatus, OfflineAttendanceOperation } from "../../lib/offline/types";

interface OfflineReconciliationDialogProps {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
}

function statusLabel(
  status: AttendanceMarkStatus | null | undefined,
  t: ReturnType<typeof useI18n>["t"]
): string {
  if (status == null) return t("common.notMarked");
  return t(attendanceStatusLabelKey(status) as Parameters<typeof t>[0]);
}

function OpRow({
  op,
  onResolve,
}: {
  op: OfflineAttendanceOperation;
  onResolve: (id: string, resolution: "apply_offline" | "keep_server" | "cancelled") => void;
}) {
  const { t } = useI18n();

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-slate-800">{op.clientDisplay}</p>
          <p className="text-slate-500">
            {op.dateStr} · {t("offline.reconciliation.groupLesson")}
          </p>
        </div>
        <span
          className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
            op.status === "applied"
              ? "bg-indigo-50 text-indigo-700"
              : op.status === "conflict"
                ? "bg-amber-50 text-amber-800"
                : op.status === "failed"
                  ? "bg-rose-50 text-rose-700"
                  : "bg-slate-100 text-slate-600"
          }`}
        >
          {t(`offline.opStatus.${op.status}` as Parameters<typeof t>[0])}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
        <div className="rounded-lg bg-slate-50 p-2">
          <p className="text-slate-400 uppercase text-[10px] font-semibold">
            {t("offline.reconciliation.inSnapshot")}
          </p>
          <p>{statusLabel(op.expectedOldStatus, t)}</p>
        </div>
        <div className="rounded-lg bg-slate-50 p-2">
          <p className="text-slate-400 uppercase text-[10px] font-semibold">
            {t("offline.reconciliation.proposedOffline")}
          </p>
          <p>{statusLabel(op.newStatus, t)}</p>
        </div>
        <div className="rounded-lg bg-slate-50 p-2">
          <p className="text-slate-400 uppercase text-[10px] font-semibold">
            {t("offline.reconciliation.onServer")}
          </p>
          <p>{statusLabel(op.serverOldStatus ?? null, t)}</p>
        </div>
      </div>

      {op.status === "conflict" ? (
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={() => onResolve(op.id, "apply_offline")}
            className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-semibold cursor-pointer hover:bg-indigo-700"
          >
            {t("offline.reconciliation.applyOffline")}
          </button>
          <button
            type="button"
            onClick={() => onResolve(op.id, "keep_server")}
            className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 font-semibold cursor-pointer hover:bg-slate-50"
          >
            {t("offline.reconciliation.keepServer")}
          </button>
          <button
            type="button"
            onClick={() => onResolve(op.id, "cancelled")}
            className="px-3 py-1.5 rounded-lg text-rose-600 font-semibold cursor-pointer hover:bg-rose-50"
          >
            {t("offline.reconciliation.discard")}
          </button>
        </div>
      ) : null}

      {op.lastError ? <p className="text-rose-600 text-[11px]">{op.lastError}</p> : null}
    </div>
  );
}

export default function OfflineReconciliationDialog({
  open,
  onClose,
  onComplete,
}: OfflineReconciliationDialogProps) {
  const { t } = useI18n();
  const queue = useOfflineStore((s) => s.queue);
  const { syncQueue, resolveConflict, dismissApplied, syncing } = useOfflineSyncEngine();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!queue) return null;

  const ops = queue.operations;
  const drafts = queue.paymentDrafts;
  const pendingCount = ops.filter((o) => o.status === "pending" || o.status === "failed").length;
  const conflictCount = ops.filter((o) => o.status === "conflict").length;
  const allDone = pendingCount === 0 && conflictCount === 0;

  const handlePrimary = async () => {
    if (allDone) {
      await dismissApplied();
      onComplete();
      onClose();
      return;
    }
    await syncQueue();
  };

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
          />
          <motion.div
            initial={{ y: 12, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 12, opacity: 0, scale: 0.98 }}
            className="relative bg-white rounded-xl border border-slate-200 shadow-xl p-5 max-w-lg w-full max-h-[90vh] flex flex-col"
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">{t("offline.reconciliation.title")}</h3>
                <p className="text-xs text-slate-500 mt-1">{t("offline.reconciliation.description")}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
                aria-label={t("common.close")}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 overflow-y-auto flex-1 min-h-0 pr-1">
              {ops.length === 0 && drafts.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-4">{t("offline.reconciliation.empty")}</p>
              ) : null}

              {ops.map((op) => (
                <OpRow key={op.id} op={op} onResolve={resolveConflict} />
              ))}

              {drafts.length > 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 space-y-2">
                  <p className="text-xs font-semibold text-amber-900 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {t("offline.reconciliation.paymentDraftsTitle")}
                  </p>
                  <p className="text-[11px] text-amber-800">{t("offline.reconciliation.paymentDraftsHint")}</p>
                  <ul className="space-y-1">
                    {drafts.map((d) => (
                      <li key={d.id} className="text-[11px] text-slate-700">
                        · {d.reminderLabel}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {allDone && ops.some((o) => o.status === "applied") ? (
                <p className="text-xs text-indigo-700 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  {t("offline.reconciliation.allSynced")}
                </p>
              ) : null}
            </div>

            <div className="flex justify-end gap-2 pt-4 mt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={onClose}
                disabled={syncing}
                className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer disabled:opacity-60"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void handlePrimary()}
                disabled={syncing}
                className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg cursor-pointer disabled:opacity-60 flex items-center gap-1.5"
              >
                {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                {allDone ? t("common.close") : t("offline.reconciliation.syncNow")}
              </button>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
