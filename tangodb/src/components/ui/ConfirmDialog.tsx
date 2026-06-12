import { useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { AlertTriangle } from "lucide-react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Подтвердить",
  cancelLabel = "Отмена",
  pending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
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
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
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
            className="relative bg-white rounded-xl border border-slate-200 shadow-xl p-6 max-w-sm w-full space-y-4"
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

            <div className="flex items-center justify-end gap-2.5 pt-1">
              <button
                onClick={onCancel}
                disabled={pending}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer disabled:opacity-60"
              >
                {cancelLabel}
              </button>
              <button
                onClick={onConfirm}
                disabled={pending}
                className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors cursor-pointer disabled:opacity-60"
              >
                {pending ? "..." : confirmLabel}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
