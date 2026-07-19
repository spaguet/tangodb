import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarDays, Clock, Coins, Edit, Layers, MapPin, Trash2, User, X, XCircle } from "lucide-react";
import { useCancelGroupLessonOccurrence, useDeleteScheduleSlot } from "../../hooks/useSchedule";
import { useDeletePersonalLesson, usePersonalLessons } from "../../hooks/usePersonalLessons";
import { usePermissions } from "../../hooks/usePermissions";
import { useOrganization } from "../../organization/OrganizationProvider";
import { useToast } from "../../App";
import {
  canManageGroupLesson,
  canPayPersonalLesson,
  canReadLessonClients,
  canShowPaidStatus,
  canWritePersonalLesson,
  maskClientDisplay,
} from "../../lib/scheduleLessonAccess";
import { useI18n } from "../../hooks/useI18n";
import { isRecurringGroupSlot } from "../../lib/groupLessonRepeat";
import type { DisplayLesson } from "../../types";
import ConfirmDialog from "../ui/ConfirmDialog";
import RequirePermission from "../RequirePermission";
import PayPersonalLessonModal, { type PayPersonalLessonTarget } from "./PayPersonalLessonModal";

interface LessonInfoPopupProps {
  lesson: DisplayLesson | null;
  locationName?: string;
  disciplineName?: string;
  teacherName?: string;
  onClose: () => void;
  onEdit?: (lesson: DisplayLesson) => void;
  onSuccess?: () => void;
  onPaymentSuccess?: () => void;
}

const detailLabelCls = "text-[10px] font-semibold uppercase tracking-wider text-slate-400";
const detailValueCls = "text-sm text-slate-800";

function lessonTitle(
  lesson: DisplayLesson,
  disciplineName: string | undefined,
  clientLabel: string,
  t: ReturnType<typeof useI18n>["t"],
  clientNotSpecified: string
): string {
  if (lesson.kind === "group") {
    const groupLabel = lesson.groupName?.trim();
    if (groupLabel) return groupLabel;
    return disciplineName ?? t("common.groupLesson");
  }
  return clientLabel !== clientNotSpecified && clientLabel !== t("common.client")
    ? clientLabel
    : t("common.personalLesson");
}

export default function LessonInfoPopup({
  lesson,
  locationName,
  disciplineName,
  teacherName,
  onClose,
  onEdit,
  onSuccess,
  onPaymentSuccess,
}: LessonInfoPopupProps) {
  const { t, formatDate } = useI18n();
  const toast = useToast();
  const { memberId } = useOrganization();
  const { role, can, isReadOnly } = usePermissions();
  const deleteScheduleSlot = useDeleteScheduleSlot();
  const cancelGroupLessonOccurrence = useCancelGroupLessonOccurrence();
  const deletePersonalLesson = useDeletePersonalLesson();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [cancelOneConfirmOpen, setCancelOneConfirmOpen] = useState(false);
  const [payTarget, setPayTarget] = useState<PayPersonalLessonTarget | null>(null);
  const personalLessonsQuery = usePersonalLessons({
    enabled: lesson?.kind === "personal",
  });

  useEffect(() => {
    if (!lesson) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lesson, onClose]);

  const permissionContext = useMemo(
    () =>
      lesson
        ? { disciplineId: lesson.disciplineId, locationId: lesson.locationId }
        : undefined,
    [lesson]
  );

  const canReadClients = lesson ? canReadLessonClients(role, lesson, can) : false;

  const clientLabel =
    lesson?.kind === "personal"
      ? maskClientDisplay(lesson.clientDisplay, canReadClients)
      : "";

  const canEdit =
    lesson &&
    (lesson.kind === "group"
      ? canManageGroupLesson(role, lesson.date, isReadOnly)
      : canWritePersonalLesson(role, memberId, lesson, can, isReadOnly));

  const canDelete = canEdit;

  const canCancelOneOccurrence =
    lesson?.kind === "group" &&
    canEdit &&
    isRecurringGroupSlot(lesson.validFrom, lesson.validTo);

  const canPay =
    lesson?.kind === "personal" &&
    canPayPersonalLesson(role, memberId, lesson, can, isReadOnly);

  const handleOpenPay = () => {
    if (lesson?.kind !== "personal") return;
    const fullLesson = personalLessonsQuery.data?.find((row) => row.id === lesson.lessonId);
    if (!fullLesson) {
      toast(t("schedule.error.loadLessonFailed"), "error");
      return;
    }
    setPayTarget({
      lessonId: fullLesson.id,
      date: fullLesson.date,
      timeStart: fullLesson.timeStart,
      timeEnd: fullLesson.timeEnd,
      clientId1: fullLesson.clientId1,
      clientId2: fullLesson.clientId2,
      clientId3: fullLesson.clientId3,
      clientDisplay: fullLesson.clientDisplay,
      price: fullLesson.price,
      locationId: fullLesson.locationId ?? null,
      disciplineId: fullLesson.disciplineId ?? null,
    });
  };

  const handleDelete = async () => {
    if (!lesson) return;

    if (lesson.kind === "group") {
      const res = await deleteScheduleSlot.mutateAsync({ id: lesson.slotId, editDate: lesson.date });
      if (!res.success) {
        toast(res.error ?? t("schedule.error.deleteClassFailed"), "error");
        return;
      }
      toast(t("schedule.success.groupDeleted"), "success");
    } else {
      const res = await deletePersonalLesson.mutateAsync({ id: lesson.lessonId, lessonDate: lesson.date });
      if (!res.success) {
        toast(res.error ?? t("schedule.error.deleteLessonFailed"), "error");
        return;
      }
      toast(t("schedule.success.personalDeleted"), "success");
    }

    setDeleteConfirmOpen(false);
    onSuccess?.();
    onClose();
  };

  const handleCancelOneOccurrence = async () => {
    if (!lesson || lesson.kind !== "group") return;

    const res = await cancelGroupLessonOccurrence.mutateAsync({
      slotId: lesson.slotId,
      cancelDate: lesson.date,
    });
    if (!res.success) {
      toast(res.error ?? t("schedule.error.cancelOneFailed"), "error");
      return;
    }

    toast(t("schedule.success.oneLessonCancelled"), "success");
    setCancelOneConfirmOpen(false);
    onSuccess?.();
    onClose();
  };

  const deletePending = deleteScheduleSlot.isPending || deletePersonalLesson.isPending;
  const cancelOnePending = cancelGroupLessonOccurrence.isPending;

  return (
    <>
      <AnimatePresence>
        {lesson && (
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
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-500">
                    {lesson.kind === "group" ? t("common.groupLesson") : t("common.personalLesson")}
                  </p>
                  <h3 className="text-base font-semibold tracking-tight text-slate-900 break-words">
                    {lessonTitle(
                      lesson,
                      disciplineName,
                      clientLabel,
                      t,
                      t("schedule.lessonInfo.clientNotSpecified")
                    )}
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

              <dl className="space-y-3 font-sans">
                {lesson.kind === "personal" && (
                  <div className="flex items-start gap-2.5">
                    <User className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                    <div>
                      <dt className={detailLabelCls}>{t("common.clientsLabel")}</dt>
                      <dd className={detailValueCls}>{clientLabel}</dd>
                    </div>
                  </div>
                )}

                {disciplineName && (
                  <div className="flex items-start gap-2.5">
                    <Layers className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                    <div>
                      <dt className={detailLabelCls}>{t("common.discipline")}</dt>
                      <dd className={detailValueCls}>{disciplineName}</dd>
                    </div>
                  </div>
                )}

                <div className="flex items-start gap-2.5">
                  <CalendarDays className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                  <div>
                    <dt className={detailLabelCls}>{t("common.date")}</dt>
                    <dd className={detailValueCls}>{formatDate(lesson.date)}</dd>
                  </div>
                </div>

                <div className="flex items-start gap-2.5">
                  <Clock className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                  <div>
                    <dt className={detailLabelCls}>{t("common.time")}</dt>
                    <dd className={detailValueCls}>
                      {lesson.timeStart} – {lesson.timeEnd}
                    </dd>
                  </div>
                </div>

                {locationName && (
                  <div className="flex items-start gap-2.5">
                    <MapPin className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                    <div>
                      <dt className={detailLabelCls}>{t("schedule.form.location")}</dt>
                      <dd className={detailValueCls}>{locationName}</dd>
                    </div>
                  </div>
                )}

                {teacherName && (
                  <div className="flex items-start gap-2.5">
                    <User className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                    <div>
                      <dt className={detailLabelCls}>{t("schedule.form.teacher")}</dt>
                      <dd className={detailValueCls}>{teacherName}</dd>
                    </div>
                  </div>
                )}

                {lesson.kind === "personal" && canShowPaidStatus(role) && (
                  <div className="flex items-start gap-2.5">
                    <Clock className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                    <div>
                      <dt className={detailLabelCls}>{t("common.paymentLabel")}</dt>
                      <dd className={detailValueCls}>
                        {lesson.paid === "yes" ? (
                          <span className="text-slate-600">{t("common.paidLabel")}</span>
                        ) : (
                          <span className="text-rose-600">{t("common.unpaidLabel")}</span>
                        )}
                      </dd>
                    </div>
                  </div>
                )}
              </dl>

              {canPay ? (
                <button
                  type="button"
                  onClick={handleOpenPay}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[10px] font-sans font-semibold uppercase tracking-wider transition-colors cursor-pointer"
                >
                  <Coins className="w-3.5 h-3.5" />
                  {t("common.pay")}
                </button>
              ) : null}

              {canCancelOneOccurrence ? (
                <RequirePermission action="schedule.write" context={permissionContext}>
                  <button
                    type="button"
                    onClick={() => setCancelOneConfirmOpen(true)}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg text-[10px] font-sans font-semibold uppercase tracking-wider transition-colors cursor-pointer"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    {t("schedule.lessonInfo.cancelOne")}
                  </button>
                </RequirePermission>
              ) : null}

              <div className="flex items-center gap-2 pt-1">
                {canEdit && (
                  <RequirePermission action={lesson.kind === "group" ? "schedule.write" : "personal_lessons.write"} context={permissionContext}>
                    <button
                      type="button"
                      onClick={() => onEdit?.(lesson)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold uppercase tracking-wider rounded-lg transition-colors cursor-pointer"
                    >
                      <Edit className="w-3.5 h-3.5" />
                      {t("common.change")}
                    </button>
                  </RequirePermission>
                )}

                {canDelete && (
                  <RequirePermission action={lesson.kind === "group" ? "schedule.write" : "personal_lessons.write"} context={permissionContext}>
                    <button
                      type="button"
                      onClick={() => setDeleteConfirmOpen(true)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold uppercase tracking-wider rounded-lg transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {t("common.delete")}
                    </button>
                  </RequirePermission>
                )}

                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold uppercase tracking-wider rounded-lg transition-colors cursor-pointer"
                >
                  {t("common.close")}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={deleteConfirmOpen && lesson !== null}
        title={
          lesson?.kind === "group"
            ? t("schedule.lessonInfo.deleteGroupTitle")
            : t("schedule.lessonInfo.deletePersonalTitle")
        }
        description={
          lesson ? (
            lesson.kind === "group" ? (
              <>
                {t("schedule.lessonInfo.deleteGroupBody", {
                  label: lessonTitle(
                    lesson,
                    disciplineName,
                    clientLabel,
                    t,
                    t("schedule.lessonInfo.clientNotSpecified")
                  ),
                  date: formatDate(lesson.date),
                  timeStart: lesson.timeStart,
                  timeEnd: lesson.timeEnd,
                })}
              </>
            ) : (
              <>
                {t("schedule.lessonInfo.deletePersonalBody", {
                  client: clientLabel,
                  date: formatDate(lesson.date),
                })}
              </>
            )
          ) : (
            ""
          )
        }
        confirmLabel={t("common.delete")}
        pending={deletePending}
        onConfirm={handleDelete}
        onCancel={() => setDeleteConfirmOpen(false)}
      />

      <ConfirmDialog
        open={cancelOneConfirmOpen && lesson !== null}
        title={t("schedule.lessonInfo.cancelOneTitle")}
        description={
          lesson ? (
            t("schedule.lessonInfo.cancelOneBody", {
              label: lessonTitle(
                lesson,
                disciplineName,
                clientLabel,
                t,
                t("schedule.lessonInfo.clientNotSpecified")
              ),
              date: formatDate(lesson.date),
              timeStart: lesson.timeStart,
              timeEnd: lesson.timeEnd,
            })
          ) : (
            ""
          )
        }
        confirmLabel={t("schedule.lessonInfo.cancelOneConfirm")}
        pending={cancelOnePending}
        onConfirm={handleCancelOneOccurrence}
        onCancel={() => setCancelOneConfirmOpen(false)}
      />

      <PayPersonalLessonModal
        lesson={payTarget}
        toast={toast}
        onClose={() => setPayTarget(null)}
        onSuccess={() => {
          setPayTarget(null);
          onPaymentSuccess?.();
          onClose();
        }}
      />
    </>
  );
}
