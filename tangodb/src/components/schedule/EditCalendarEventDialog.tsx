import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarPlus, X } from "lucide-react";
import { resolveMutationError } from "../../lib/resolveMutationError";
import { useI18n } from "../../hooks/useI18n";
import { usePermissions } from "../../hooks/usePermissions";
import { useUpdateCalendarEvent } from "../../hooks/useCalendarEvents";
import type { CalendarEventType, EventDisplayLesson } from "../../types";
import AppSelect, { fieldCls } from "../ui/AppSelect";

interface EditCalendarEventDialogProps {
  lesson: EventDisplayLesson | null;
  open: boolean;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
  onClose: () => void;
  onSuccess: () => void;
}

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

export default function EditCalendarEventDialog({
  lesson,
  open,
  toast,
  onClose,
  onSuccess,
}: EditCalendarEventDialogProps) {
  const { t } = useI18n();
  const { can } = usePermissions();
  const canSeeFinance = can("finance.read");
  const updateMutation = useUpdateCalendarEvent();

  const [title, setTitle] = useState("");
  const [eventType, setEventType] = useState<CalendarEventType>("master_class");
  const [comment, setComment] = useState("");
  const [guestTeacher, setGuestTeacher] = useState("");
  const [organizer, setOrganizer] = useState("");
  const [plannedGuestCount, setPlannedGuestCount] = useState("");
  const [actualGuestCount, setActualGuestCount] = useState("");
  const [incomeAmount, setIncomeAmount] = useState("");
  const [paymentComment, setPaymentComment] = useState("");

  useEffect(() => {
    if (!open || !lesson) return;
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
  }, [open, lesson]);

  const handleSubmit = async () => {
    if (!lesson) return;
    if (!title.trim()) {
      toast(t("schedule.event.titleRequired"), "error");
      return;
    }

    const res = await updateMutation.mutateAsync({
      eventId: lesson.eventId,
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

    if (!res.success) {
      toast(resolveMutationError(res.error, "schedule.event.updateFailed", t), "error");
      return;
    }

    toast(t("schedule.event.updateSuccess"), "success");
    onSuccess();
    onClose();
  };

  return (
    <AnimatePresence>
      {open && lesson && (
        <div className="fixed inset-0 z-[65] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => !updateMutation.isPending && onClose()}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            className="relative w-full max-w-lg max-h-[90dvh] overflow-hidden bg-white rounded-xl border border-slate-200 shadow-xl flex flex-col"
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
              <div className="flex items-center gap-2 min-w-0">
                <CalendarPlus className="w-4 h-4 text-violet-600 shrink-0" />
                <h3 className="text-base font-semibold text-slate-900 truncate">{t("schedule.event.editTitle")}</h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={updateMutation.isPending}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
                aria-label={t("common.close")}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
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
            </div>

            <div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-100 bg-slate-50/60">
              <button
                type="button"
                onClick={onClose}
                disabled={updateMutation.isPending}
                className="px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={updateMutation.isPending}
                className="px-4 py-2 text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg cursor-pointer"
              >
                {updateMutation.isPending ? t("common.saving") : t("common.save")}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
