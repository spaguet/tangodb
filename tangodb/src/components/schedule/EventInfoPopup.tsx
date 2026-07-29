import { AnimatePresence, motion } from "motion/react";
import { CalendarPlus, X } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";
import { usePermissions } from "../../hooks/usePermissions";
import { formatCurrency } from "../../lib/utils";
import type { EventDisplayLesson } from "../../types";

interface EventInfoPopupProps {
  lesson: EventDisplayLesson | null;
  locationName?: string;
  onClose: () => void;
}

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

export default function EventInfoPopup({ lesson, locationName, onClose }: EventInfoPopupProps) {
  const { t, formatDate } = useI18n();
  const { can } = usePermissions();
  const canSeeFinance = can("finance.read");

  if (!lesson) return null;

  const typeLabel =
    lesson.eventType === "open_lesson"
      ? t("schedule.event.typeOpenLesson")
      : t("schedule.event.typeMasterClass");

  const paymentLabel =
    lesson.paymentStatus === "paid"
      ? t("schedule.event.paymentPaid")
      : lesson.paymentStatus === "partial"
        ? t("schedule.event.paymentPartial")
        : t("schedule.event.paymentUnpaid");

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[55] flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-slate-900/30"
          onClick={onClose}
        />
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          className="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-xl border border-slate-200 shadow-xl"
        >
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
            <div className="flex items-center gap-2 min-w-0">
              <CalendarPlus className="w-4 h-4 text-violet-600 shrink-0" />
              <h3 className="text-base font-semibold text-slate-900 truncate">{lesson.title}</h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
              aria-label={t("common.close")}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-4 space-y-3 text-sm">
            <div>
              <span className={labelCls}>{t("schedule.event.typeLabel")}</span>
              <p className="text-slate-800">{typeLabel}</p>
            </div>
            <div>
              <span className={labelCls}>{t("schedule.form.currentDate")}</span>
              <p className="text-slate-800">
                {formatDate(lesson.date)} · {lesson.timeStart}–{lesson.timeEnd}
              </p>
            </div>
            {locationName ? (
              <div>
                <span className={labelCls}>{t("schedule.form.location")}</span>
                <p className="text-slate-800">{locationName}</p>
              </div>
            ) : null}
            {lesson.guestTeacher ? (
              <div>
                <span className={labelCls}>{t("schedule.event.guestTeacherLabel")}</span>
                <p className="text-slate-800">{lesson.guestTeacher}</p>
              </div>
            ) : null}
            {lesson.organizer ? (
              <div>
                <span className={labelCls}>{t("schedule.event.organizerLabel")}</span>
                <p className="text-slate-800">{lesson.organizer}</p>
              </div>
            ) : null}
            {lesson.plannedGuestCount != null ? (
              <div>
                <span className={labelCls}>{t("schedule.event.plannedGuestsLabel")}</span>
                <p className="text-slate-800">{lesson.plannedGuestCount}</p>
              </div>
            ) : null}
            {lesson.comment ? (
              <div>
                <span className={labelCls}>{t("schedule.event.commentLabel")}</span>
                <p className="text-slate-800 whitespace-pre-wrap">{lesson.comment}</p>
              </div>
            ) : null}
            {canSeeFinance ? (
              <div className="pt-2 border-t border-slate-100 space-y-2">
                <div>
                  <span className={labelCls}>{t("schedule.event.paymentStatusLabel")}</span>
                  <p className="text-slate-800">{paymentLabel}</p>
                </div>
                {lesson.incomeAmount != null && lesson.incomeAmount > 0 ? (
                  <div>
                    <span className={labelCls}>{t("schedule.event.incomeLabel")}</span>
                    <p className="text-slate-800 font-semibold">
                      {formatCurrency(lesson.incomeAmount)} {lesson.currency ?? "RUB"}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
