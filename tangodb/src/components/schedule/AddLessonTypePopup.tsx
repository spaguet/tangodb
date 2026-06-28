import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Layers, User, X } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";

export interface ScheduleCellPrefill {
  locationId: string;
  locationName: string;
  date: string;
  dayOfWeek: number;
  timeStart: string;
}

interface AddLessonTypePopupProps {
  prefill: ScheduleCellPrefill | null;
  canOfferGroup: boolean;
  canOfferPersonal: boolean;
  onSelectGroup: () => void;
  onSelectPersonal: () => void;
  onClose: () => void;
}

export default function AddLessonTypePopup({
  prefill,
  canOfferGroup,
  canOfferPersonal,
  onSelectGroup,
  onSelectPersonal,
  onClose,
}: AddLessonTypePopupProps) {
  const { t } = useI18n();

  useEffect(() => {
    if (!prefill) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prefill, onClose]);

  return (
    <AnimatePresence>
      {prefill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
          />
          <motion.div
            initial={{ scale: 0.97, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.97, opacity: 0, y: 8 }}
            transition={{ duration: 0.18 }}
            className="relative bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden max-w-sm w-full p-4 panel-card-stack"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-500">
                  {t("schedule.popup.newClass")}
                </p>
                <h3 className="text-base font-semibold tracking-tight text-slate-900">
                  {prefill.locationName} · {prefill.date} · {prefill.timeStart}
                </h3>
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

            <div className="grid grid-cols-1 gap-2">
              {canOfferGroup && (
                <button
                  type="button"
                  onClick={onSelectGroup}
                  className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50 transition-colors cursor-pointer text-left"
                >
                  <Layers className="w-5 h-5 text-indigo-600 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{t("common.groupLesson")}</p>
                    <p className="text-xs text-slate-500">{t("schedule.popup.groupWeekly")}</p>
                  </div>
                </button>
              )}

              {canOfferPersonal && (
                <button
                  type="button"
                  onClick={onSelectPersonal}
                  className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50 transition-colors cursor-pointer text-left"
                >
                  <User className="w-5 h-5 text-indigo-600 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{t("common.personalLesson")}</p>
                    <p className="text-xs text-slate-500">{t("schedule.popup.personalOnce")}</p>
                  </div>
                </button>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
