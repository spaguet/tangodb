import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarOff, X } from "lucide-react";
import { resolveMutationError } from "../../lib/resolveMutationError";
import { useTeacherGroupVacation } from "../../hooks/useSchedule";
import {
  computeTeacherVacationPreview,
  flattenTeacherVacationPreview,
} from "../../lib/groupLessonOccurrences";
import {
  exceedsRangePreviewCap,
  maxRepeatEndDate,
  RANGE_PREVIEW_DATE_CAP,
} from "../../lib/dateRecurrenceLimits";
import { toISODateLocal } from "../../lib/scheduleWeek";
import { useI18n } from "../../hooks/useI18n";
import type { ScheduleSlot } from "../../types";
import AppSelect, { fieldCls } from "../ui/AppSelect";
import { btnAddCls, btnCancelCls } from "../ui/buttonStyles";

export interface TeacherVacationOption {
  id: string;
  label: string;
}

interface TeacherVacationDialogProps {
  open: boolean;
  initialTeacherMemberId?: string;
  teacherOptions: TeacherVacationOption[];
  scheduleSlots: ScheduleSlot[];
  disciplineMap: Map<string, string>;
  locationMap: Map<string, string>;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
  onClose: () => void;
  onSuccess: () => void;
}

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

export default function TeacherVacationDialog({
  open,
  initialTeacherMemberId = "",
  teacherOptions,
  scheduleSlots,
  disciplineMap,
  locationMap,
  toast,
  onClose,
  onSuccess,
}: TeacherVacationDialogProps) {
  const { t, formatDate } = useI18n();
  const vacationMutation = useTeacherGroupVacation();
  const todayISO = toISODateLocal(new Date());

  const [teacherMemberId, setTeacherMemberId] = useState(initialTeacherMemberId);
  const [startDate, setStartDate] = useState(todayISO);
  const [endDate, setEndDate] = useState("");

  useEffect(() => {
    if (!open) return;
    setTeacherMemberId(initialTeacherMemberId || teacherOptions[0]?.id || "");
    setStartDate(todayISO);
    setEndDate("");
  }, [open, initialTeacherMemberId, teacherOptions, todayISO]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !vacationMutation.isPending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, vacationMutation.isPending, onClose]);

  const previewItems = useMemo(() => {
    if (!teacherMemberId || !startDate || !endDate || endDate < startDate) return [];
    return computeTeacherVacationPreview(scheduleSlots, teacherMemberId, startDate, endDate);
  }, [teacherMemberId, startDate, endDate, scheduleSlots]);

  const previewDates = useMemo(() => flattenTeacherVacationPreview(previewItems), [previewItems]);
  const previewOverCap = exceedsRangePreviewCap(previewDates.length);
  const vacationEndMax = maxRepeatEndDate(startDate || todayISO);

  const handleSubmit = async () => {
    if (!teacherMemberId || !startDate || !endDate) {
      toast(t("schedule.error.vacationInvalidRange"), "error");
      return;
    }

    if (previewOverCap) {
      toast(t("schedule.error.previewDatesTooMany", { max: RANGE_PREVIEW_DATE_CAP }), "error");
      return;
    }

    if (previewDates.length === 0) {
      toast(t("schedule.lessonInfo.cancelPreviewEmpty"), "error");
      return;
    }

    const res = await vacationMutation.mutateAsync({
      teacherMemberId,
      startDate,
      endDate,
    });

    if (!res.success) {
      toast(resolveMutationError(res.error, "schedule.error.vacationFailed", t), "error");
      return;
    }

    if (res.alreadyApplied) {
      toast(t("schedule.success.cancelAlreadyApplied"), "info");
    } else {
      toast(
        t("schedule.success.teacherVacationCancelled", {
          count: res.cancelledCount,
          series: res.seriesCount,
        }),
        "success"
      );
    }

    onSuccess();
    onClose();
  };

  const confirmLabel = t("schedule.vacation.confirm", { count: previewDates.length });

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !vacationMutation.isPending && onClose()}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
          />
          <motion.div
            initial={{ scale: 0.97, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.97, opacity: 0, y: 8 }}
            transition={{ duration: 0.18 }}
            className="relative bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden max-w-lg w-full p-4 panel-card-stack max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-500">
                  {t("schedule.vacation.title")}
                </p>
                <h3 className="text-base font-semibold tracking-tight text-slate-900">
                  {t("schedule.vacation.subtitle")}
                </h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={vacationMutation.isPending}
                aria-label={t("common.close")}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 cursor-pointer transition-colors shrink-0 disabled:opacity-60"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 font-sans">
              <AppSelect
                label={t("schedule.form.teacher")}
                value={teacherMemberId}
                onChange={(e) => setTeacherMemberId(e.target.value)}
              >
                <option value="">{t("schedule.vacation.selectTeacher")}</option>
                {teacherOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </AppSelect>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="field-stack">
                  <label className={labelCls} htmlFor="vacation-start-date">
                    {t("schedule.vacation.rangeStart")}
                  </label>
                  <input
                    id="vacation-start-date"
                    type="date"
                    required
                    min={todayISO}
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className={fieldCls}
                  />
                </div>
                <div className="field-stack">
                  <label className={labelCls} htmlFor="vacation-end-date">
                    {t("schedule.vacation.rangeEnd")}
                  </label>
                  <input
                    id="vacation-end-date"
                    type="date"
                    required
                    min={startDate || todayISO}
                    max={vacationEndMax}
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className={fieldCls}
                  />
                </div>
              </div>

              <div className="rounded-lg border border-amber-100 bg-amber-50/60 p-3 space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                  {t("schedule.lessonInfo.cancelPreviewTitle", { count: previewDates.length })}
                </p>
                {previewItems.length > 0 ? (
                  <ul className="max-h-48 overflow-y-auto space-y-2 text-xs text-slate-700">
                    {previewItems.map((item) => {
                      const label =
                        item.groupName?.trim() ||
                        (item.disciplineId ? disciplineMap.get(item.disciplineId) : undefined) ||
                        t("common.groupLesson");
                      const locationName = item.locationId
                        ? locationMap.get(item.locationId)
                        : undefined;

                      return (
                        <li key={item.slotId} className="rounded-md border border-amber-100/80 bg-white/70 p-2">
                          <p className="font-semibold text-slate-800">
                            {label} · {item.timeStart}–{item.timeEnd}
                          </p>
                          {locationName ? (
                            <p className="text-[11px] text-slate-500 mt-0.5">{locationName}</p>
                          ) : null}
                          <p className="text-[11px] text-slate-600 mt-1">
                            {item.dates.map((date) => formatDate(date)).join(", ")}
                          </p>
                        </li>
                      );
                    })}
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

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={vacationMutation.isPending}
                className={`flex-1 ${btnCancelCls}`}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={
                  vacationMutation.isPending ||
                  !teacherMemberId ||
                  !endDate ||
                  previewDates.length === 0 ||
                  previewOverCap
                }
                className={`flex-1 ${btnAddCls}`}
              >
                <CalendarOff className="w-3.5 h-3.5 shrink-0" />
                <span className="text-center leading-snug">
                  {vacationMutation.isPending ? t("common.saving") : confirmLabel}
                </span>
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
