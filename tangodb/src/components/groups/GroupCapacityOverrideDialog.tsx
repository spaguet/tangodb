import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, X } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";

interface GroupCapacityOverrideDialogProps {
  open: boolean;
  groupLabel?: string;
  pending?: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

export default function GroupCapacityOverrideDialog({
  open,
  groupLabel,
  pending = false,
  onConfirm,
  onCancel,
}: GroupCapacityOverrideDialogProps) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open) setReason("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pending, onCancel]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !pending && onCancel()}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
          />
          <motion.div
            initial={{ scale: 0.97, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.97, opacity: 0, y: 8 }}
            className="relative bg-white rounded-xl border border-slate-200 shadow-xl max-w-md w-full p-4 panel-card-stack"
          >
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-amber-50 shrink-0">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-base font-semibold tracking-tight text-slate-900">
                    {t("groupCapacity.override.title")}
                  </h3>
                  <button
                    type="button"
                    onClick={onCancel}
                    disabled={pending}
                    aria-label={t("common.close")}
                    className="p-1 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 cursor-pointer shrink-0 disabled:opacity-60"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-sm text-slate-600 mt-1 leading-relaxed">
                  {t("groupCapacity.override.body", { group: groupLabel ?? t("common.groupLesson") })}
                </p>
              </div>
            </div>

            <div className="field-stack">
              <label className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block">
                {t("groupCapacity.override.reasonLabel")}
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                required
                placeholder={t("groupCapacity.override.reasonPlaceholder")}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none"
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={onCancel}
                disabled={pending}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold uppercase tracking-wider rounded-lg transition-colors cursor-pointer disabled:opacity-60"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => onConfirm(reason.trim())}
                disabled={pending || !reason.trim()}
                className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold uppercase tracking-wider rounded-lg transition-colors cursor-pointer disabled:opacity-60"
              >
                {pending ? t("common.saving") : t("groupCapacity.override.confirm")}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
