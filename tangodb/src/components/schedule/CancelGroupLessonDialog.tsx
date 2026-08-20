import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarDays, Clock, X, XCircle } from "lucide-react";
import { resolveMutationError } from "../../lib/resolveMutationError";
import { useCancelGroupLessonOccurrences } from "../../hooks/useSchedule";
import { computeWeeklyOccurrencesInRange } from "../../lib/groupLessonOccurrences";
import {
  exceedsRangePreviewCap,
  maxRepeatEndDate,
  RANGE_PREVIEW_DATE_CAP,
} from "../../lib/dateRecurrenceLimits";
import { useI18n } from "../../hooks/useI18n";
import type { GroupDisplayLesson } from "../../types";
import { fieldCls } from "../ui/AppSelect";
import { btnCancelCls, btnDestructiveCls } from "../ui/buttonStyles";

interface CancelGroupLessonDialogProps {
  lesson: GroupDisplayLesson | null;
  disciplineName?: string;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
  onClose: () => void;
  onSuccess: () => void;
}

type CancelMode = "single" | "range";

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

export default function CancelGroupLessonDialog({
  lesson,
  disciplineName,
  toast,
  onClose,
  onSuccess,
}: CancelGroupLessonDialogProps) {
  const { t, formatDate } = useI18n();
  const cancelOccurrences = useCancelGroupLessonOccurrences();

  const [mode, setMode] = useState<CancelMode>("single");
  const [rangeEndDate, setRangeEndDate] = useState("");

  useEffect(() => {
    if (!lesson) return;
    setMode("single");
    setRangeEndDate(lesson.date);
  }, [lesson]);

  useEffect(() => {
    if (!lesson) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !cancelOccurrences.isPending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lesson, cancelOccurrences.isPending, onClose]);

  const groupLabel = useMemo(() => {
    if (!lesson) return "";
    const name = lesson.groupName?.trim();
    if (name) return name;
    return disciplineName ?? t("common.groupLesson");
  }, [lesson, disciplineName, t]);

  const previewDates = useMemo(() => {
    if (!lesson) return [];
    const endDate = mode === "single" ? lesson.date : rangeEndDate;
    if (!endDate || endDate < lesson.date) return [];

    return computeWeeklyOccurrencesInRange(
      lesson.date,
      endDate,
      lesson.dayOfWeek,
      lesson.validFrom,
      lesson.validTo
    );
  }, [lesson, mode, rangeEndDate]);

  const previewOverCap = exceedsRangePreviewCap(previewDates.length);
  const rangeEndMax =
    lesson != null ? (lesson.validTo ?? maxRepeatEndDate(lesson.date)) : undefined;

  const handleSubmit = async () => {
    if (!lesson || previewDates.length === 0) return;

    if (previewOverCap) {
      toast(t("schedule.error.previewDatesTooMany", { max: RANGE_PREVIEW_DATE_CAP }), "error");
      return;
    }

    const res = await cancelOccurrences.mutateAsync({
      slotId: lesson.slotId,
      cancelDates: previewDates,
    });

    if (!res.success) {
      toast(resolveMutationError(res.error, "schedule.error.cancelOneFailed", t), "error");
      return;
    }

    if (res.alreadyApplied) {
      toast(t("schedule.success.cancelAlreadyApplied"), "info");
    } else if (res.cancelledCount === 1) {
      toast(t("schedule.success.oneLessonCancelled"), "success");
    } else {
      toast(t("schedule.success.multipleLessonsCancelled", { count: res.cancelledCount }), "success");
    }

    onSuccess();
    onClose();
  };

  const confirmLabel =
    previewDates.length === 1
      ? t("schedule.lessonInfo.cancelOneConfirm")
      : t("schedule.lessonInfo.cancelMultipleConfirm", { count: previewDates.length });

  return (
    <AnimatePresence>
      {lesson && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !cancelOccurrences.isPending && onClose()}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
          />
          <motion.div
            initial={{ scale: 0.97, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.97, opacity: 0, y: 8 }}
            transition={{ duration: 0.18 }}
            className="relative bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden max-w-md w-full p-4 panel-card-stack max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-600">
                  {t("schedule.lessonInfo.cancelOneTitle")}
                </p>
                <h3 className="text-base font-semibold tracking-tight text-slate-900 break-words">{groupLabel}</h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={cancelOccurrences.isPending}
                aria-label={t("common.close")}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 cursor-pointer transition-colors shrink-0 disabled:opacity-60"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 font-sans">
              <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-3 space-y-2">
                <div className="flex items-start gap-2.5">
                  <CalendarDays className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                  <div>
                    <p className={labelCls}>{t("schedule.lessonInfo.cancelStartDate")}</p>
                    <p className="text-sm text-slate-800">{formatDate(lesson.date)}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <Clock className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                  <div>
                    <p className={labelCls}>{t("common.time")}</p>
                    <p className="text-sm text-slate-800">
                      {lesson.timeStart} – {lesson.timeEnd}
                    </p>
                  </div>
                </div>
              </div>

              <fieldset className="space-y-2">
                <legend className={labelCls}>{t("schedule.lessonInfo.cancelModeLabel")}</legend>
                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="radio"
                    name="cancel-mode"
                    checked={mode === "single"}
                    onChange={() => setMode("single")}
                    className="text-indigo-600"
                  />
                  {t("schedule.lessonInfo.cancelModeSingle")}
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="radio"
                    name="cancel-mode"
                    checked={mode === "range"}
                    onChange={() => setMode("range")}
                    className="text-indigo-600"
                  />
                  {t("schedule.lessonInfo.cancelModeRange")}
                </label>
              </fieldset>

              {mode === "range" ? (
                <div className="field-stack">
                  <label className={labelCls} htmlFor="cancel-range-end">
                    {t("schedule.lessonInfo.cancelRangeEnd")}
                  </label>
                  <input
                    id="cancel-range-end"
                    type="date"
                    required
                    min={lesson.date}
                    max={rangeEndMax}
                    value={rangeEndDate}
                    onChange={(e) => setRangeEndDate(e.target.value)}
                    className={fieldCls}
                  />
                </div>
              ) : null}

              <div className="rounded-lg border border-amber-100 bg-amber-50/60 p-3 space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                  {t("schedule.lessonInfo.cancelPreviewTitle", { count: previewDates.length })}
                </p>
                {previewDates.length > 0 ? (
                  <ul className="max-h-32 overflow-y-auto space-y-1 text-xs text-slate-700">
                    {previewDates.map((date) => (
                      <li key={date} className="flex items-center gap-1.5">
                        <span className="w-1 h-1 rounded-full bg-amber-500 shrink-0" />
                        {formatDate(date)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-500">{t("schedule.lessonInfo.cancelPreviewEmpty")}</p>
                )}
                {previewOverCap ? (
                  <p className="text-xs text-red-600">
                    {t("schedule.error.previewDatesTooMany", { max: RANGE_PREVIEW_DATE_CAP })}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={cancelOccurrences.isPending}
                className={`flex-1 ${btnCancelCls}`}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={cancelOccurrences.isPending || previewDates.length === 0 || previewOverCap}
                className={`flex-1 ${btnDestructiveCls}`}
              >
                <XCircle className="w-4 h-4" />
                {cancelOccurrences.isPending ? t("common.saving") : confirmLabel}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
