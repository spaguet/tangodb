import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { ImageDown, X } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";
import AppSelect from "../ui/AppSelect";
import { btnOpenCls } from "../ui/buttonStyles";

export interface SchedulePngLocationOption {
  id: string;
  label: string;
}

interface SchedulePngExportDialogProps {
  open: boolean;
  options: SchedulePngLocationOption[];
  initialLocationId?: string | null;
  onClose: () => void;
  onExport: (locationId: string) => void;
}

export default function SchedulePngExportDialog({
  open,
  options,
  initialLocationId,
  onClose,
  onExport,
}: SchedulePngExportDialogProps) {
  const { t } = useI18n();
  const [selectedId, setSelectedId] = useState("");

  useEffect(() => {
    if (!open) return;
    const fallback = options[0]?.id ?? "";
    const preferred =
      initialLocationId && options.some((option) => option.id === initialLocationId)
        ? initialLocationId
        : fallback;
    setSelectedId(preferred);
  }, [open, options, initialLocationId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handleExport = () => {
    if (!selectedId) return;
    onExport(selectedId);
  };

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[62] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
            onClick={onClose}
          />
          <motion.div
            initial={{ scale: 0.97, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.97, opacity: 0, y: 8 }}
            transition={{ duration: 0.18 }}
            className="relative bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden max-w-sm w-full p-4 panel-card-stack"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-500">
                  {t("schedule.export.png")}
                </p>
                <h3 className="text-base font-semibold tracking-tight text-slate-900">
                  {t("schedule.export.pngPickLocationTitle")}
                </h3>
                <p className="text-xs text-slate-500 mt-1">{t("schedule.export.pngPickLocationHint")}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("common.close")}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 cursor-pointer transition-colors shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <AppSelect
              label={t("schedule.form.location")}
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </AppSelect>

            <div className="flex items-center justify-end gap-2.5 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={handleExport}
                disabled={!selectedId}
                className={btnOpenCls}
              >
                <ImageDown className="w-4 h-4" />
                {t("schedule.export.png")}
              </button>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}
