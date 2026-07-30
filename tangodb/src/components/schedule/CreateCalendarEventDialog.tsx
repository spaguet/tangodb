import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarPlus, Plus, Trash2, X } from "lucide-react";
import { resolveMutationError } from "../../lib/resolveMutationError";
import { toISODateLocal } from "../../lib/scheduleWeek";
import { useI18n } from "../../hooks/useI18n";
import { usePermissions } from "../../hooks/usePermissions";
import {
  conflictKey,
  useCalendarEventConflictsPreview,
  useCreateCalendarEvent,
  type CalendarEventConflict,
  type CalendarEventSessionInput,
} from "../../hooks/useCalendarEvents";
import { getPaymentMethodLabel } from "../../hooks/usePayments";
import type { CalendarEventPaymentStatus, CalendarEventType, PaymentMethod } from "../../types";
import AppSelect, { fieldCls } from "../ui/AppSelect";
import DatePickerField from "../ui/DatePickerField";
import TimeSelect from "../ui/TimeSelect";

export interface LocationOption {
  id: string;
  name: string;
}

interface CreateCalendarEventDialogProps {
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

export default function CreateCalendarEventDialog({
  open,
  locations,
  disciplineMap,
  teamMap,
  toast,
  onClose,
  onSuccess,
}: CreateCalendarEventDialogProps) {
  const { t, formatDate, locale } = useI18n();
  const { can } = usePermissions();
  const canSeeFinance = can("finance.read");
  const createMutation = useCreateCalendarEvent();

  const defaultLocationId = locations[0]?.id ?? "";

  const [step, setStep] = useState<"form" | "preview">("form");
  const [title, setTitle] = useState("");
  const [eventType, setEventType] = useState<CalendarEventType>("master_class");
  const [comment, setComment] = useState("");
  const [guestTeacher, setGuestTeacher] = useState("");
  const [organizer, setOrganizer] = useState("");
  const [plannedGuestCount, setPlannedGuestCount] = useState("");
  const [sessions, setSessions] = useState<CalendarEventSessionInput[]>([]);
  const [incomeAmount, setIncomeAmount] = useState("");
  const [paidAmount, setPaidAmount] = useState("");
  const [paymentStatus, setPaymentStatus] = useState<CalendarEventPaymentStatus>("unpaid");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [paymentComment, setPaymentComment] = useState("");
  const [selectedConflictKeys, setSelectedConflictKeys] = useState<Set<string>>(new Set());
  const [idempotencyKey, setIdempotencyKey] = useState("");

  useEffect(() => {
    if (!open) return;
    setStep("form");
    setTitle("");
    setEventType("master_class");
    setComment("");
    setGuestTeacher("");
    setOrganizer("");
    setPlannedGuestCount("");
    setSessions(defaultLocationId ? [emptySession(defaultLocationId)] : []);
    setIncomeAmount("");
    setPaidAmount("");
    setPaymentStatus("unpaid");
    setPaymentMethod("cash");
    setPaymentComment("");
    setSelectedConflictKeys(new Set());
    setIdempotencyKey(crypto.randomUUID());
  }, [open, defaultLocationId]);

  const previewEnabled = step === "preview" && sessions.length > 0;
  const previewQuery = useCalendarEventConflictsPreview(sessions, previewEnabled);

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
    if (!previewQuery.data?.success) return 0;
    return cancellableConflicts.filter((c) => !selectedConflictKeys.has(conflictKey(c))).length;
  }, [previewQuery.data, cancellableConflicts, selectedConflictKeys]);

  const handleGoPreview = () => {
    if (!title.trim()) {
      toast(t("schedule.event.titleRequired"), "error");
      return;
    }
    if (sessions.length === 0) {
      toast(t("schedule.event.sessionsEmpty"), "error");
      return;
    }
    for (const session of sessions) {
      if (!session.date || !session.locationId || session.timeEnd <= session.timeStart) {
        toast(t("schedule.event.sessionInvalid"), "error");
        return;
      }
    }
    setStep("preview");
  };

  const handleSubmit = async () => {
    if (!previewQuery.data?.success) return;

    if (eventConflicts.length > 0) {
      toast(t("schedule.event.eventConflictBlocked"), "error");
      return;
    }

    const conflicts = cancellableConflicts;
    if (conflicts.some((c) => !selectedConflictKeys.has(conflictKey(c)))) {
      toast(t("schedule.event.unresolvedConflicts"), "error");
      return;
    }

    const groupCancellations = conflicts
      .filter((c): c is Extract<CalendarEventConflict, { kind: "group" }> =>
        c.kind === "group" && selectedConflictKeys.has(conflictKey(c))
      )
      .map((c) => ({ slotId: c.slotId, date: c.occurrenceDate }));

    const personalCancellations = conflicts
      .filter((c): c is Extract<CalendarEventConflict, { kind: "personal" }> =>
        c.kind === "personal" && selectedConflictKeys.has(conflictKey(c))
      )
      .map((c) => ({ lessonId: c.lessonId }));

    const income = canSeeFinance ? Number(incomeAmount) || 0 : 0;
    const paid = canSeeFinance ? Number(paidAmount) || 0 : 0;

    const res = await createMutation.mutateAsync({
      idempotencyKey,
      title: title.trim(),
      eventType,
      comment: comment.trim() || undefined,
      guestTeacher: guestTeacher.trim() || undefined,
      organizer: organizer.trim() || undefined,
      plannedGuestCount: plannedGuestCount ? Number(plannedGuestCount) : null,
      incomeAmount: income,
      paidAmount: paid,
      paymentStatus: canSeeFinance ? paymentStatus : "unpaid",
      paymentMethod,
      paymentComment: paymentComment.trim() || undefined,
      sessions,
      groupCancellations,
      personalCancellations,
    });

    if (!res.success) {
      toast(resolveMutationError(res.error, "schedule.event.createFailed", t), "error");
      return;
    }

    if (res.alreadyApplied) {
      toast(t("schedule.event.alreadyApplied"), "info");
    } else {
      toast(
        t("schedule.event.createSuccess", {
          sessions: res.sessionCount,
          group: res.groupCancelCount,
          personal: res.personalCancelCount,
        }),
        "success"
      );
    }

    onSuccess();
    onClose();
  };

  const confirmLabel = t("schedule.event.confirmCreate", {
    cancelCount: selectedConflictKeys.size,
  });

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => !createMutation.isPending && onClose()}
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
                <h3 className="text-base font-semibold text-slate-900 truncate">{t("schedule.event.title")}</h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={createMutation.isPending}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
                aria-label={t("common.close")}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {step === "form" ? (
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
                      <div key={index} className="grid sm:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end p-3 rounded-lg border border-slate-100 bg-slate-50/60">
                        <DatePickerField
                          label={t("schedule.form.currentDate")}
                          value={session.date}
                          onChange={(date) =>
                            setSessions((prev) =>
                              prev.map((s, i) => (i === index ? { ...s, date } : s))
                            )
                          }
                        />
                        <TimeSelect
                          label={t("common.timeStart")}
                          value={session.timeStart}
                          onChange={(timeStart) =>
                            setSessions((prev) =>
                              prev.map((s, i) => (i === index ? { ...s, timeStart } : s))
                            )
                          }
                        />
                        <TimeSelect
                          label={t("common.timeEnd")}
                          value={session.timeEnd}
                          onChange={(timeEnd) =>
                            setSessions((prev) =>
                              prev.map((s, i) => (i === index ? { ...s, timeEnd } : s))
                            )
                          }
                        />
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
                      <p className="text-xs font-semibold text-slate-700">{t("schedule.event.financeSection")}</p>
                      <div className="grid sm:grid-cols-2 gap-3">
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
                          <span className={labelCls}>{t("schedule.event.paidLabel")}</span>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            className={fieldCls}
                            value={paidAmount}
                            onChange={(e) => setPaidAmount(e.target.value)}
                          />
                        </div>
                      </div>
                      <AppSelect
                        label={t("schedule.event.paymentStatusLabel")}
                        value={paymentStatus}
                        onChange={(e) => setPaymentStatus(e.target.value as CalendarEventPaymentStatus)}
                      >
                        <option value="unpaid">{t("schedule.event.paymentUnpaid")}</option>
                        <option value="partial">{t("schedule.event.paymentPartial")}</option>
                        <option value="paid">{t("schedule.event.paymentPaid")}</option>
                      </AppSelect>
                      <AppSelect
                        label={t("finance.payroll.methodLabel")}
                        value={paymentMethod}
                        onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                      >
                        {(["cash", "transfer", "card", "other"] as PaymentMethod[]).map((method) => (
                          <option key={method} value={method}>
                            {getPaymentMethodLabel(method, t, locale)}
                          </option>
                        ))}
                      </AppSelect>
                      <div>
                        <span className={labelCls}>{t("schedule.event.paymentCommentLabel")}</span>
                        <input className={fieldCls} value={paymentComment} onChange={(e) => setPaymentComment(e.target.value)} />
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <p className="text-sm text-slate-600">{t("schedule.event.previewIntro")}</p>
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
                        <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
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
                  disabled={createMutation.isPending}
                  className="px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  {t("common.back")}
                </button>
              ) : null}
              <button
                type="button"
                onClick={onClose}
                disabled={createMutation.isPending}
                className="px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                {t("common.cancel")}
              </button>
              {step === "form" ? (
                <button
                  type="button"
                  onClick={handleGoPreview}
                  className="px-4 py-2 text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-lg cursor-pointer"
                >
                  {t("schedule.event.checkConflicts")}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={
                    createMutation.isPending ||
                    previewQuery.isLoading ||
                    previewQuery.isError ||
                    eventConflicts.length > 0 ||
                    unresolvedCount > 0 ||
                    (previewQuery.data != null && !previewQuery.data.success)
                  }
                  className="px-4 py-2 text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg cursor-pointer"
                >
                  {createMutation.isPending ? t("common.saving") : confirmLabel}
                </button>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
