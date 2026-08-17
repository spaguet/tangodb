import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarPlus, Plus, Trash2, X } from "lucide-react";
import { resolveMutationError } from "../../lib/resolveMutationError";
import { toISODateLocal } from "../../lib/scheduleWeek";
import { useI18n } from "../../hooks/useI18n";
import { usePermissions } from "../../hooks/usePermissions";
import {
  conflictKey,
  sessionsEqual,
  useCalendarEventConflictsPreview,
  useCalendarEventSessions,
  useUpdateCalendarEvent,
  useUpdateCalendarEventWithCancellations,
  type CalendarEventConflict,
  type CalendarEventSessionInput,
} from "../../hooks/useCalendarEvents";
import type { CalendarEventType, EventDisplayLesson } from "../../types";
import AppSelect, { fieldCls } from "../ui/AppSelect";
import DatePickerField from "../ui/DatePickerField";
import type { LocationOption } from "./CreateCalendarEventDialog";

interface EditCalendarEventDialogProps {
  lesson: EventDisplayLesson | null;
  open: boolean;
  locations: LocationOption[];
  disciplineMap: Map<string, string>;
  teamMap: Map<string, string>;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
  onClose: () => void;
  onSuccess: () => void;
}

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

function emptySession(defaultLocationId: string): CalendarEventSessionInput {
  return {
    date: toISODateLocal(new Date()),
    timeStart: "14:00",
    timeEnd: "20:00",
    locationId: defaultLocationId,
  };
}

export default function EditCalendarEventDialog({
  lesson,
  open,
  locations,
  disciplineMap,
  teamMap,
  toast,
  onClose,
  onSuccess,
}: EditCalendarEventDialogProps) {
  const { t, formatDate } = useI18n();
  const { can } = usePermissions();
  const canSeeFinance = can("finance.read");
  const updateMutation = useUpdateCalendarEvent();
  const updateWithCancellations = useUpdateCalendarEventWithCancellations();
  const sessionsQuery = useCalendarEventSessions(lesson?.eventId ?? null, open);

  const defaultLocationId = locations[0]?.id ?? "";
  const isPending = updateMutation.isPending || updateWithCancellations.isPending;

  const [step, setStep] = useState<"form" | "preview">("form");
  const [initialSessions, setInitialSessions] = useState<CalendarEventSessionInput[]>([]);
  const [title, setTitle] = useState("");
  const [eventType, setEventType] = useState<CalendarEventType>("master_class");
  const [comment, setComment] = useState("");
  const [guestTeacher, setGuestTeacher] = useState("");
  const [organizer, setOrganizer] = useState("");
  const [plannedGuestCount, setPlannedGuestCount] = useState("");
  const [actualGuestCount, setActualGuestCount] = useState("");
  const [sessions, setSessions] = useState<CalendarEventSessionInput[]>([]);
  const [incomeAmount, setIncomeAmount] = useState("");
  const [paymentComment, setPaymentComment] = useState("");
  const [selectedConflictKeys, setSelectedConflictKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open || !lesson || !sessionsQuery.data) return;
    setStep("form");
    setTitle(lesson.title);
    setEventType(lesson.eventType);
    setComment(lesson.comment ?? "");
    setGuestTeacher(lesson.guestTeacher ?? "");
    setOrganizer(lesson.organizer ?? "");
    setPlannedGuestCount(
      lesson.plannedGuestCount != null ? String(lesson.plannedGuestCount) : ""
    );
    setActualGuestCount(lesson.actualGuestCount != null ? String(lesson.actualGuestCount) : "");
    setIncomeAmount(lesson.incomeAmount != null ? String(lesson.incomeAmount) : "");
    setPaymentComment("");
    const loaded = sessionsQuery.data.map((s) => ({ ...s }));
    setInitialSessions(loaded);
    setSessions(loaded);
    setSelectedConflictKeys(new Set());
  }, [open, lesson, sessionsQuery.data]);

  const sessionsChanged = useMemo(
    () => !sessionsEqual(sessions, initialSessions),
    [sessions, initialSessions]
  );

  const previewEnabled = step === "preview" && sessions.length > 0;
  const previewQuery = useCalendarEventConflictsPreview(
    sessions,
    previewEnabled,
    lesson?.eventId
  );

  const eventConflicts = useMemo(
    () => (previewQuery.data?.success ? previewQuery.data.conflicts.filter((c) => c.kind === "event") : []),
    [previewQuery.data]
  );

  const cancellableConflicts = useMemo(
    () => (previewQuery.data?.success ? previewQuery.data.conflicts.filter((c) => c.kind !== "event") : []),
    [previewQuery.data]
  );

  useEffect(() => {
    if (!previewQuery.data?.success) return;
    setSelectedConflictKeys(new Set(cancellableConflicts.map(conflictKey)));
  }, [previewQuery.data, cancellableConflicts]);

  const conflictLabel = useCallback(
    (conflict: CalendarEventConflict) => {
      const dateLabel = formatDate(conflict.occurrenceDate);
      const timeLabel = `${conflict.timeStart}–${conflict.timeEnd}`;
      if (conflict.kind === "event") {
        return [dateLabel, timeLabel, conflict.title].filter(Boolean).join(" · ");
      }
      if (conflict.kind === "group") {
        const group = conflict.groupName || t("common.groupLesson");
        const teacher = conflict.teacherMemberId
          ? teamMap.get(conflict.teacherMemberId)
          : undefined;
        const discipline = conflict.disciplineId
          ? disciplineMap.get(conflict.disciplineId)
          : undefined;
        return [dateLabel, timeLabel, group, discipline, teacher].filter(Boolean).join(" · ");
      }
      const client = conflict.clientDisplay || t("common.personalLabel");
      const teacher = conflict.teacherMemberId
        ? teamMap.get(conflict.teacherMemberId)
        : undefined;
      return [dateLabel, timeLabel, client, teacher].filter(Boolean).join(" · ");
    },
    [disciplineMap, teamMap, t, formatDate]
  );

  const unresolvedCount = useMemo(() => {
    return cancellableConflicts.filter((c) => !selectedConflictKeys.has(conflictKey(c))).length;
  }, [cancellableConflicts, selectedConflictKeys]);

  const buildPayload = () => ({
    eventId: lesson!.eventId,
    title: title.trim(),
    eventType,
    comment: comment.trim() || undefined,
    guestTeacher: guestTeacher.trim() || undefined,
    organizer: organizer.trim() || undefined,
    plannedGuestCount: plannedGuestCount ? Number(plannedGuestCount) : null,
    actualGuestCount: actualGuestCount ? Number(actualGuestCount) : null,
    incomeAmount: canSeeFinance ? Number(incomeAmount) || 0 : undefined,
    paymentComment: canSeeFinance ? paymentComment.trim() || undefined : undefined,
  });

  const validateForm = () => {
    if (!title.trim()) {
      toast(t("schedule.event.titleRequired"), "error");
      return false;
    }
    if (sessions.length === 0) {
      toast(t("schedule.event.sessionsEmpty"), "error");
      return false;
    }
    for (const session of sessions) {
      if (!session.date || !session.locationId || session.timeEnd <= session.timeStart) {
        toast(t("schedule.event.sessionInvalid"), "error");
        return false;
      }
    }
    return true;
  };

  const handleGoPreview = () => {
    if (!validateForm()) return;
    setStep("preview");
  };

  const handleSaveMetadata = async () => {
    if (!lesson || !validateForm()) return;

    const res = await updateMutation.mutateAsync(buildPayload());
    if (!res.success) {
      toast(resolveMutationError(res.error, "schedule.event.updateFailed", t), "error");
      return;
    }
    toast(t("schedule.event.updateSuccess"), "success");
    onSuccess();
    onClose();
  };

  const handleSubmitWithSessions = async () => {
    if (!lesson || !previewQuery.data?.success) return;

    if (eventConflicts.length > 0) {
      toast(t("schedule.event.eventConflictBlocked"), "error");
      return;
    }

    if (cancellableConflicts.some((c) => !selectedConflictKeys.has(conflictKey(c)))) {
      toast(t("schedule.event.unresolvedConflicts"), "error");
      return;
    }

    const groupCancellations = cancellableConflicts
      .filter((c): c is Extract<CalendarEventConflict, { kind: "group" }> =>
        c.kind === "group" && selectedConflictKeys.has(conflictKey(c))
      )
      .map((c) => ({ slotId: c.slotId, date: c.occurrenceDate }));

    const personalCancellations = cancellableConflicts
      .filter((c): c is Extract<CalendarEventConflict, { kind: "personal" }> =>
        c.kind === "personal" && selectedConflictKeys.has(conflictKey(c))
      )
      .map((c) => ({ lessonId: c.lessonId }));

    const res = await updateWithCancellations.mutateAsync({
      ...buildPayload(),
      sessions,
      groupCancellations,
      personalCancellations,
    });

    if (!res.success) {
      toast(resolveMutationError(res.error, "schedule.event.updateFailed", t), "error");
      return;
    }

    toast(
      t("schedule.event.updateWithSessionsSuccess", {
        sessions: res.sessionCount,
        group: res.groupCancelCount,
        personal: res.personalCancelCount,
      }),
      "success"
    );
    onSuccess();
    onClose();
  };

  const confirmLabel = t("schedule.event.confirmUpdate", {
    cancelCount: selectedConflictKeys.size,
  });

  const isLoadingSessions = open && sessionsQuery.isLoading;

  return (
    <AnimatePresence>
      {open && lesson && (
        <div className="fixed inset-0 z-[65] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => !isPending && onClose()}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            className="relative w-full max-w-2xl max-h-[90dvh] overflow-hidden bg-white rounded-xl border border-slate-200 shadow-xl flex flex-col"
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
              <div className="flex items-center gap-2 min-w-0">
                <CalendarPlus className="w-4 h-4 text-violet-600 shrink-0" />
                <h3 className="text-base font-semibold text-slate-900 truncate">{t("schedule.event.editTitle")}</h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={isPending}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
                aria-label={t("common.close")}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {isLoadingSessions ? (
                <p className="text-sm text-slate-400">{t("common.loading.default")}</p>
              ) : step === "form" ? (
                <>
                  <div>
                    <span className={labelCls}>{t("schedule.event.nameLabel")}</span>
                    <input className={fieldCls} value={title} onChange={(e) => setTitle(e.target.value)} />
                  </div>
                  <AppSelect
                    label={t("schedule.event.typeLabel")}
                    value={eventType}
                    onChange={(e) => setEventType(e.target.value as CalendarEventType)}
                  >
                    <option value="master_class">{t("schedule.event.typeMasterClass")}</option>
                    <option value="open_lesson">{t("schedule.event.typeOpenLesson")}</option>
                  </AppSelect>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <span className={labelCls}>{t("schedule.event.guestTeacherLabel")}</span>
                      <input className={fieldCls} value={guestTeacher} onChange={(e) => setGuestTeacher(e.target.value)} />
                    </div>
                    <div>
                      <span className={labelCls}>{t("schedule.event.organizerLabel")}</span>
                      <input className={fieldCls} value={organizer} onChange={(e) => setOrganizer(e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <span className={labelCls}>{t("schedule.event.commentLabel")}</span>
                    <textarea
                      className={`${fieldCls} min-h-[72px] resize-y`}
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                    />
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <span className={labelCls}>{t("schedule.event.plannedGuestsLabel")}</span>
                      <input
                        type="number"
                        min={0}
                        className={fieldCls}
                        value={plannedGuestCount}
                        onChange={(e) => setPlannedGuestCount(e.target.value)}
                      />
                    </div>
                    <div>
                      <span className={labelCls}>{t("schedule.event.actualGuestsLabel")}</span>
                      <input
                        type="number"
                        min={0}
                        className={fieldCls}
                        value={actualGuestCount}
                        onChange={(e) => setActualGuestCount(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className={labelCls}>{t("schedule.event.sessionsLabel")}</span>
                      <button
                        type="button"
                        disabled={!defaultLocationId}
                        onClick={() => setSessions((prev) => [...prev, emptySession(defaultLocationId)])}
                        className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-violet-700 hover:text-violet-800 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        {t("schedule.event.addSession")}
                      </button>
                    </div>
                    {sessions.map((session, index) => (
                      <div
                        key={session.sessionId ?? `new-${index}`}
                        className="grid sm:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end p-3 rounded-lg border border-slate-100 bg-slate-50/60"
                      >
                        <DatePickerField
                          label={t("schedule.form.currentDate")}
                          value={session.date}
                          onChange={(date) =>
                            setSessions((prev) =>
                              prev.map((s, i) => (i === index ? { ...s, date } : s))
                            )
                          }
                        />
                        <div>
                          <span className={labelCls}>{t("common.timeStart")}</span>
                          <input
                            type="time"
                            className={fieldCls}
                            value={session.timeStart}
                            onChange={(e) =>
                              setSessions((prev) =>
                                prev.map((s, i) => (i === index ? { ...s, timeStart: e.target.value } : s))
                              )
                            }
                          />
                        </div>
                        <div>
                          <span className={labelCls}>{t("common.timeEnd")}</span>
                          <input
                            type="time"
                            className={fieldCls}
                            value={session.timeEnd}
                            onChange={(e) =>
                              setSessions((prev) =>
                                prev.map((s, i) => (i === index ? { ...s, timeEnd: e.target.value } : s))
                              )
                            }
                          />
                        </div>
                        <div className="sm:col-span-4 grid sm:grid-cols-[1fr_auto] gap-2 items-end">
                          <AppSelect
                            label={t("schedule.form.location")}
                            value={session.locationId}
                            onChange={(e) =>
                              setSessions((prev) =>
                                prev.map((s, i) => (i === index ? { ...s, locationId: e.target.value } : s))
                              )
                            }
                          >
                            {locations.map((loc) => (
                              <option key={loc.id} value={loc.id}>
                                {loc.name}
                              </option>
                            ))}
                          </AppSelect>
                          {sessions.length > 1 ? (
                            <button
                              type="button"
                              onClick={() => setSessions((prev) => prev.filter((_, i) => i !== index))}
                              className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg cursor-pointer self-end"
                              aria-label={t("common.delete")}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>

                  {canSeeFinance ? (
                    <div className="space-y-3 pt-2 border-t border-slate-100">
                      <div>
                        <span className={labelCls}>{t("schedule.event.incomeLabel")}</span>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className={fieldCls}
                          value={incomeAmount}
                          onChange={(e) => setIncomeAmount(e.target.value)}
                        />
                      </div>
                      <div>
                        <span className={labelCls}>{t("schedule.event.paymentCommentLabel")}</span>
                        <input className={fieldCls} value={paymentComment} onChange={(e) => setPaymentComment(e.target.value)} />
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  {previewQuery.isLoading ? (
                    <p className="text-sm text-slate-400">{t("common.loading.default")}</p>
                  ) : previewQuery.isError ? (
                    <p className="text-sm text-rose-600">{t("schedule.event.previewFailed")}</p>
                  ) : previewQuery.data && !previewQuery.data.success ? (
                    <p className="text-sm text-rose-600">
                      {resolveMutationError(previewQuery.data.error, "schedule.event.previewFailed", t)}
                    </p>
                  ) : (
                    <>
                      {cancellableConflicts.length > 0 ? (
                        <p className="text-sm text-slate-600">{t("schedule.event.previewIntro")}</p>
                      ) : null}
                      {eventConflicts.length > 0 ? (
                        <ul className="space-y-2">
                          {eventConflicts.map((conflict) => (
                            <li
                              key={conflictKey(conflict)}
                              className="p-2 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-800"
                            >
                              {conflictLabel(conflict)}
                            </li>
                          ))}
                          <p className="text-sm text-rose-700">{t("schedule.event.eventConflictBlocked")}</p>
                        </ul>
                      ) : null}
                      {cancellableConflicts.length === 0 && eventConflicts.length === 0 ? (
                        <p className="text-sm text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
                          {t("schedule.event.noConflicts")}
                        </p>
                      ) : cancellableConflicts.length > 0 ? (
                        <ul className="space-y-2 max-h-64 overflow-y-auto">
                          {cancellableConflicts.map((conflict) => {
                            const key = conflictKey(conflict);
                            const checked = selectedConflictKeys.has(key);
                            return (
                              <li key={key} className="flex items-start gap-2 p-2 rounded-lg border border-slate-100">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() =>
                                    setSelectedConflictKeys((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(key)) next.delete(key);
                                      else next.add(key);
                                      return next;
                                    })
                                  }
                                  className="mt-0.5"
                                />
                                <div className="min-w-0">
                                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                                    {conflict.kind === "group"
                                      ? t("common.groupLesson")
                                      : t("common.personalLabel")}
                                  </p>
                                  <p className="text-sm text-slate-800">{conflictLabel(conflict)}</p>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                      {unresolvedCount > 0 ? (
                        <p className="text-sm text-amber-700">{t("schedule.event.unresolvedHint", { count: unresolvedCount })}</p>
                      ) : null}
                    </>
                  )}
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-3 border-t border-slate-100 bg-slate-50/60">
              {step === "preview" ? (
                <button
                  type="button"
                  onClick={() => setStep("form")}
                  disabled={isPending}
                  className="px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  {t("common.back")}
                </button>
              ) : null}
              <button
                type="button"
                onClick={onClose}
                disabled={isPending}
                className="px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                {t("common.cancel")}
              </button>
              {step === "form" ? (
                sessionsChanged ? (
                  <button
                    type="button"
                    onClick={handleGoPreview}
                    disabled={isLoadingSessions}
                    className="px-4 py-2 text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg cursor-pointer"
                  >
                    {t("schedule.event.checkConflicts")}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSaveMetadata}
                    disabled={isPending || isLoadingSessions}
                    className="px-4 py-2 text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg cursor-pointer"
                  >
                    {isPending ? t("common.saving") : t("common.save")}
                  </button>
                )
              ) : (
                <button
                  type="button"
                  onClick={handleSubmitWithSessions}
                  disabled={
                    isPending ||
                    previewQuery.isLoading ||
                    previewQuery.isError ||
                    eventConflicts.length > 0 ||
                    unresolvedCount > 0 ||
                    (previewQuery.data != null && !previewQuery.data.success)
                  }
                  className="px-4 py-2 text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg cursor-pointer"
                >
                  {isPending ? t("common.saving") : confirmLabel}
                </button>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
