import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import AppSelect, { fieldCls } from "../ui/AppSelect";
import {
  ATTENDANCE_CORRECTION_REASONS,
  ATTENDANCE_UNDO_WINDOW_MS,
  type AttendanceCorrectionReasonCode,
} from "../../lib/paymentCorrection";
import { useCorrectAttendance } from "../../hooks/usePaymentCorrections";
import { useI18n } from "../../hooks/useI18n";
import { resolveMutationError } from "../../lib/resolveMutationError";

const labelCls = "text-[10px] text-ink-500 font-sans uppercase tracking-wider font-semibold block";

export interface AttendanceCorrectionTarget {
  dateStr: string;
  subId: string;
  scheduleGroupId: string;
  disciplineId?: string | null;
  clientDisplay: string;
  oldStatus: string | null;
  newStatus: "present" | "absent" | "freeze" | "excused";
  lastChangedAt?: number;
}

interface AttendanceCorrectionDialogProps {
  target: AttendanceCorrectionTarget | null;
  open: boolean;
  onClose: () => void;
  onSuccess: (result: { correctionId?: string; clientDisplay: string }) => void;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
}

export function isWithinAttendanceUndoWindow(lastChangedAt?: number): boolean {
  if (!lastChangedAt) return false;
  return Date.now() - lastChangedAt < ATTENDANCE_UNDO_WINDOW_MS;
}

export default function AttendanceCorrectionDialog({
  target,
  open,
  onClose,
  onSuccess,
  toast,
}: AttendanceCorrectionDialogProps) {
  const { t } = useI18n();
  const correctAttendance = useCorrectAttendance();
  const [reasonCode, setReasonCode] = useState<AttendanceCorrectionReasonCode>("misclick");
  const [reasonComment, setReasonComment] = useState("");
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!open) return;
    setReasonCode("misclick");
    setReasonComment("");
  }, [open, target?.subId, target?.newStatus]);

  const handleSubmit = async () => {
    if (!target) return;

    const res = await correctAttendance.mutateAsync({
      dateStr: target.dateStr,
      subId: target.subId,
      scheduleGroupId: target.scheduleGroupId,
      newStatus: target.newStatus,
      reasonCode,
      reasonComment: reasonComment.trim() || undefined,
      disciplineId: target.disciplineId,
      expectedOldStatus: target.oldStatus,
      idempotencyKey,
    });

    if (!res.success) {
      toast(resolveMutationError(res.error, "corrections.error.attendanceFailed", t), "error");
      return;
    }

    onSuccess({
      correctionId: res.correctionId,
      clientDisplay: target.clientDisplay,
    });
    onClose();
  };

  if (!target) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-ink-950/40" onClick={onClose} />
          <motion.div
            className="relative w-full sm:max-w-md bg-white rounded-t-xl sm:rounded-xl shadow-xl"
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
          >
            <div className="flex items-start justify-between gap-3 p-4 border-b border-ink-100">
              <div>
                <p className="text-base font-semibold text-ink-900">{t("corrections.attendance.dialogTitle")}</p>
                <p className="text-xs text-ink-500 mt-1">{target.clientDisplay}</p>
              </div>
              <button type="button" onClick={onClose} className="p-1 text-ink-400 hover:text-ink-600">
                <X size={18} />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <p className="text-sm text-ink-600">
                {target.oldStatus ?? "—"} → {target.newStatus}
              </p>

              <AppSelect
                label={t("corrections.payment.reason")}
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value as AttendanceCorrectionReasonCode)}
              >
                {ATTENDANCE_CORRECTION_REASONS.map((r) => (
                  <option key={r.code} value={r.code}>
                    {t(r.labelKey as Parameters<typeof t>[0])}
                  </option>
                ))}
              </AppSelect>

              <div>
                <label className={labelCls}>{t("corrections.payment.comment")}</label>
                <textarea
                  value={reasonComment}
                  onChange={(e) => setReasonComment(e.target.value)}
                  rows={2}
                  className={`${fieldCls} resize-y min-h-[3rem]`}
                  placeholder={t("corrections.payment.commentPlaceholder")}
                />
              </div>
            </div>

            <div className="p-4 border-t border-ink-100 flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 rounded-xl border border-ink-200 text-sm font-medium text-ink-600"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                disabled={correctAttendance.isPending}
                onClick={() => void handleSubmit()}
                className="flex-1 py-2.5 rounded-xl bg-gold-700 text-white text-sm font-semibold disabled:opacity-60"
              >
                {correctAttendance.isPending ? t("common.saving") : t("corrections.payment.confirm")}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
