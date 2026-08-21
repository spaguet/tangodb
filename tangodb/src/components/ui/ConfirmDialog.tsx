import { useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { AlertTriangle } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  pending?: boolean;
  alternateConfirmLabel?: string;
  alternatePending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onAlternateConfirm?: () => void;
  zClassName?: string;
}

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  pending = false,
  alternateConfirmLabel,
  alternatePending = false,
  onConfirm,
  onCancel,
  onAlternateConfirm,
  zClassName = "z-50",
}: ConfirmDialogProps) {
  const { t } = useI18n();
  const resolvedConfirmLabel = confirmLabel ?? t("common.confirm");
  const resolvedCancelLabel = cancelLabel ?? t("common.cancel");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  return (
    <AnimatePresence>
      {open && (
        <div
          className={`fixed inset-0 ${zClassName} flex items-center justify-center p-4`}
          role="dialog"
          aria-modal="true"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCancel}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
          />
          <motion.div
            initial={{ y: 12, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 12, opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            className="relative bg-white rounded-xl border border-slate-200 shadow-xl p-4 max-w-sm w-full panel-card-stack"
          >
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 shrink-0 bg-rose-50 rounded-full flex items-center justify-center text-rose-600">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1.5 pt-0.5">
                <h3 className="text-sm font-semibold text-slate-900 tracking-tight">{title}</h3>
                <p className="text-xs text-slate-500 leading-relaxed">{description}</p>
              </div>
            </div>

            <div className="flex flex-col gap-2 pt-1">
              {onAlternateConfirm && alternateConfirmLabel ? (
                <button
                  onClick={onAlternateConfirm}
                  disabled={pending || alternatePending}
                  className="w-full px-4 py-2 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors cursor-pointer disabled:opacity-60"
                >
                  {alternatePending ? "..." : alternateConfirmLabel}
                </button>
              ) : null}
              <div className="flex items-center justify-end gap-2.5">
                <button
                  onClick={onCancel}
                  disabled={pending || alternatePending}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer disabled:opacity-60"
                >
                  {resolvedCancelLabel}
                </button>
                <button
                  onClick={onConfirm}
                  disabled={pending || alternatePending}
                  className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors cursor-pointer disabled:opacity-60"
                >
                  {pending ? "..." : resolvedConfirmLabel}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
