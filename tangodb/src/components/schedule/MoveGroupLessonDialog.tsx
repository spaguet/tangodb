import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRightLeft, CalendarDays, Clock, Layers, MapPin, User, X } from "lucide-react";
import { resolveMutationError } from "../../lib/resolveMutationError";
import { useMoveGroupLessonOccurrence } from "../../hooks/useSchedule";
import { findScheduleConflict, formatScheduleConflictToast } from "../../lib/scheduleConflicts";
import { computeAutoTimeEnd, validateTimeRange } from "../../lib/scheduleTime";
import { toISODateLocal } from "../../lib/scheduleWeek";
import { useI18n } from "../../hooks/useI18n";
import type { GroupDisplayLesson } from "../../types";
import { fieldCls } from "../ui/AppSelect";
import { btnAddCls, btnCancelCls } from "../ui/buttonStyles";
import TimeSelect from "../ui/TimeSelect";

interface MoveGroupLessonDialogProps {
  lesson: GroupDisplayLesson | null;
  locationName?: string;
  disciplineName?: string;
  teacherName?: string;
  scheduleSlots: Array<{
    id?: string;
    dayOfWeek: number;
    time: string;
    timeEnd: string;
    locationId?: string | null;
    validFrom?: string;
    validTo?: string | null;
  }>;
  personalLessons: Array<{
    id: string;
    date: string;
    timeStart: string;
    timeEnd: string;
    locationId?: string | null;
  }>;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
  onClose: () => void;
  onSuccess: () => void;
}

const labelCls = "text-[10px] text-ink-500 font-sans uppercase tracking-wider font-semibold block";

export default function MoveGroupLessonDialog({
  lesson,
  locationName,
  disciplineName,
  teacherName,
  scheduleSlots,
  personalLessons,
  toast,
  onClose,
  onSuccess,
}: MoveGroupLessonDialogProps) {
  const { t, locale, formatDate } = useI18n();
  const moveOccurrence = useMoveGroupLessonOccurrence();
  const todayISO = toISODateLocal(new Date());

  const [targetDate, setTargetDate] = useState("");
  const [timeStart, setTimeStart] = useState("19:00");
  const [timeEnd, setTimeEnd] = useState("20:00");

  useEffect(() => {
    if (!lesson) return;
    setTargetDate(lesson.date);
    setTimeStart(lesson.timeStart);
    setTimeEnd(lesson.timeEnd);
  }, [lesson]);

  useEffect(() => {
    if (!lesson) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !moveOccurrence.isPending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lesson, moveOccurrence.isPending, onClose]);

  const groupLabel = useMemo(() => {
    if (!lesson) return "";
    const name = lesson.groupName?.trim();
    if (name) return name;
    return disciplineName ?? t("common.groupLesson");
  }, [lesson, disciplineName, t]);

  const clientConflictPreview = useMemo(() => {
    if (!lesson || !targetDate) return null;
    if (validateTimeRange(timeStart, timeEnd)) return null;

    return findScheduleConflict(
      {
        date: targetDate,
        timeStart,
        timeEnd,
        locationId: lesson.locationId ?? null,
      },
      personalLessons,
      scheduleSlots,
      t,
      locale
    );
  }, [lesson, targetDate, timeStart, timeEnd, personalLessons, scheduleSlots, t, locale]);

  const timeRangeError = useMemo(
    () => (targetDate ? validateTimeRange(timeStart, timeEnd) : null),
    [targetDate, timeStart, timeEnd]
  );

  const handleTimeStartChange = (next: string) => {
    setTimeStart(next);
    setTimeEnd(computeAutoTimeEnd(next, []));
  };

  const handleSubmit = async () => {
    if (!lesson) return;

    if (!targetDate) {
      toast(t("schedule.error.moveInvalidTarget"), "error");
      return;
    }

    const rangeError = validateTimeRange(timeStart, timeEnd);
    if (rangeError) {
      toast(rangeError, "error");
      return;
    }

    if (clientConflictPreview) {
      toast(formatScheduleConflictToast(targetDate, clientConflictPreview, t, locale), "error");
      return;
    }

    const res = await moveOccurrence.mutateAsync({
      slotId: lesson.slotId,
      sourceDate: lesson.date,
      targetDate,
      targetTimeStart: timeStart,
      targetTimeEnd: timeEnd,
    });

    if (!res.success) {
      toast(resolveMutationError(res.error, "schedule.error.moveFailed", t), "error");
      return;
    }

    toast(t("schedule.success.lessonMoved"), "success");
    onSuccess();
    onClose();
  };

  return (
    <AnimatePresence>
      {lesson && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !moveOccurrence.isPending && onClose()}
            className="absolute inset-0 bg-ink-950/40 backdrop-blur-xs"
          />
          <motion.div
            initial={{ scale: 0.97, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.97, opacity: 0, y: 8 }}
            transition={{ duration: 0.18 }}
            className="relative bg-white rounded-xl border border-ink-200 shadow-xl overflow-hidden max-w-md w-full p-4 panel-card-stack max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-start justify-between gap-3 border-b border-ink-100 pb-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gold-500">
                  {t("schedule.lessonInfo.moveOneTitle")}
                </p>
                <h3 className="text-base font-semibold tracking-tight text-ink-900 break-words">{groupLabel}</h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={moveOccurrence.isPending}
                aria-label={t("common.close")}
                className="p-1 text-ink-400 hover:text-ink-700 rounded-full hover:bg-ink-100 cursor-pointer transition-colors shrink-0 disabled:opacity-60"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 font-sans">
              <div className="rounded-lg border border-ink-100 bg-ink-50/10 p-3 space-y-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                  {t("schedule.lessonInfo.moveSourceLabel")}
                </p>

                {disciplineName && (
                  <div className="flex items-start gap-2.5">
                    <Layers className="w-4 h-4 text-ink-400 shrink-0 mt-0.5" />
                    <div>
                      <p className={labelCls}>{t("common.discipline")}</p>
                      <p className="text-sm text-ink-800">{disciplineName}</p>
                    </div>
                  </div>
                )}

                <div className="flex items-start gap-2.5">
                  <CalendarDays className="w-4 h-4 text-ink-400 shrink-0 mt-0.5" />
                  <div>
                    <p className={labelCls}>{t("common.date")}</p>
                    <p className="text-sm text-ink-800">{formatDate(lesson.date)}</p>
                  </div>
                </div>

                <div className="flex items-start gap-2.5">
                  <Clock className="w-4 h-4 text-ink-400 shrink-0 mt-0.5" />
                  <div>
                    <p className={labelCls}>{t("common.time")}</p>
                    <p className="text-sm text-ink-800">
                      {lesson.timeStart} – {lesson.timeEnd}
                    </p>
                  </div>
                </div>

                {locationName && (
                  <div className="flex items-start gap-2.5">
                    <MapPin className="w-4 h-4 text-ink-400 shrink-0 mt-0.5" />
                    <div>
                      <p className={labelCls}>{t("schedule.form.location")}</p>
                      <p className="text-sm text-ink-800">{locationName}</p>
                    </div>
                  </div>
                )}

                {teacherName && (
                  <div className="flex items-start gap-2.5">
                    <User className="w-4 h-4 text-ink-400 shrink-0 mt-0.5" />
                    <div>
                      <p className={labelCls}>{t("schedule.form.teacher")}</p>
                      <p className="text-sm text-ink-800">{teacherName}</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                  {t("schedule.lessonInfo.moveTargetLabel")}
                </p>

                <div className="field-stack">
                  <label className={labelCls} htmlFor="move-lesson-date">
                    {t("common.date")}
                  </label>
                  <input
                    id="move-lesson-date"
                    type="date"
                    required
                    min={todayISO}
                    value={targetDate}
                    onChange={(e) => setTargetDate(e.target.value)}
                    className={fieldCls}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <TimeSelect
                    label={t("common.timeStart")}
                    value={timeStart}
                    onChange={handleTimeStartChange}
                    required
                  />
                  <TimeSelect label={t("common.timeEnd")} value={timeEnd} onChange={setTimeEnd} required />
                </div>

                {(timeRangeError || clientConflictPreview) && targetDate ? (
                  <p className="text-xs text-garnet-600 leading-relaxed">
                    {timeRangeError ??
                      formatScheduleConflictToast(targetDate, clientConflictPreview!, t, locale)}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={moveOccurrence.isPending}
                className={`flex-1 ${btnCancelCls}`}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={moveOccurrence.isPending || Boolean(timeRangeError) || Boolean(clientConflictPreview)}
                className={`flex-1 ${btnAddCls}`}
              >
                <ArrowRightLeft className="w-3.5 h-3.5" />
                {moveOccurrence.isPending ? t("common.saving") : t("schedule.lessonInfo.moveOneConfirm")}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
