import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Download, X } from "lucide-react";

interface CsvExportModalProps {
  open: boolean;
  filename: string;
  blobUrl: string;
  onClose: () => void;
}

export default function CsvExportModal({ open, filename, blobUrl, onClose }: CsvExportModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="csv-export-title"
        >
          <motion.button
            type="button"
            aria-label="Закрыть"
            className="absolute inset-0 bg-slate-900/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            className="relative w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-xl p-5 space-y-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <h2 id="csv-export-title" className="text-base font-semibold text-slate-800">
                  Сохранить CSV
                </h2>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Нажмите кнопку ниже — откроется меню «Поделиться» или сохранение файла.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                aria-label="Закрыть"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-[11px] font-mono text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 break-all">
              {filename}
            </p>

            <a
              href={blobUrl}
              download={filename}
              className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-sans text-sm font-semibold rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-2"
            >
              <Download className="w-4 h-4" />
              Сохранить файл
            </a>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
