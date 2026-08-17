import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Layers, User, Building2, CalendarRange, X } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";

export interface ScheduleCellPrefill {
  locationId: string;
  locationName: string;
  date: string;
  dayOfWeek: number;
  timeStart: string;
  timeEnd?: string;
}

interface AddLessonTypePopupProps {
  prefill: ScheduleCellPrefill | null;
  canOfferGroup: boolean;
  canOfferPersonal: boolean;
  canOfferRental?: boolean;
  onSelectGroup: () => void;
  onSelectPersonal: () => void;
  onSelectRental?: () => void;
  onSelectRentalSeries?: () => void;
  onClose: () => void;
}

export default function AddLessonTypePopup({
  prefill,
  canOfferGroup,
  canOfferPersonal,
  canOfferRental = false,
  onSelectGroup,
  onSelectPersonal,
  onSelectRental,
  onSelectRentalSeries,
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
            className="absolute inset-0 bg-ink-950/40 backdrop-blur-xs"
          />
          <motion.div
            initial={{ scale: 0.97, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.97, opacity: 0, y: 8 }}
            transition={{ duration: 0.18 }}
            className="relative bg-white rounded-xl border border-ink-200 shadow-xl overflow-hidden max-w-sm w-full p-4 panel-card-stack"
          >
            <div className="flex items-start justify-between gap-3 border-b border-ink-100 pb-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gold-500">
                  {t("schedule.popup.newClass")}
                </p>
                <h3 className="text-base font-semibold tracking-tight text-ink-900">
                  {prefill.locationName} · {prefill.date} · {prefill.timeStart}
                </h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("common.close")}
                className="p-1 text-ink-400 hover:text-ink-700 rounded-full hover:bg-ink-100 cursor-pointer transition-colors shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-2">
              {canOfferGroup && (
                <button
                  type="button"
                  onClick={onSelectGroup}
                  className="flex items-center gap-3 p-3 rounded-lg border border-ink-200 hover:border-gold-300 hover:bg-gold-50/10 transition-colors cursor-pointer text-left"
                >
                  <Layers className="w-5 h-5 text-gold-700 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-ink-800">{t("common.groupLesson")}</p>
                    <p className="text-xs text-ink-500">{t("schedule.popup.groupWeekly")}</p>
                  </div>
                </button>
              )}

              {canOfferPersonal && (
                <button
                  type="button"
                  onClick={onSelectPersonal}
                  className="flex items-center gap-3 p-3 rounded-lg border border-ink-200 hover:border-gold-300 hover:bg-gold-50/10 transition-colors cursor-pointer text-left"
                >
                  <User className="w-5 h-5 text-gold-700 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-ink-800">{t("common.personalLesson")}</p>
                    <p className="text-xs text-ink-500">{t("schedule.popup.personalOnce")}</p>
                  </div>
                </button>
              )}

              {canOfferRental && onSelectRental && (
                <button
                  type="button"
                  onClick={onSelectRental}
                  className="flex items-center gap-3 p-3 rounded-lg border border-ink-200 hover:border-amber-300 hover:bg-amber-50/10 transition-colors cursor-pointer text-left"
                >
                  <Building2 className="w-5 h-5 text-amber-700 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-ink-800">{t("schedule.rental.action")}</p>
                    <p className="text-xs text-ink-500">{t("schedule.popup.rentalOnce")}</p>
                  </div>
                </button>
              )}

              {canOfferRental && onSelectRentalSeries && (
                <button
                  type="button"
                  onClick={onSelectRentalSeries}
                  className="flex items-center gap-3 p-3 rounded-lg border border-ink-200 hover:border-amber-300 hover:bg-amber-50/10 transition-colors cursor-pointer text-left"
                >
                  <CalendarRange className="w-5 h-5 text-amber-700 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-ink-800">{t("rentalSeries.action")}</p>
                    <p className="text-xs text-ink-500">{t("schedule.popup.rentalSeries")}</p>
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
