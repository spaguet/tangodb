import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarDays, Clock, Coins, Edit, Layers, MapPin, Trash2, User, X, XCircle, ArrowRightLeft, CheckCircle2 } from "lucide-react";
import { useClientDirectory } from "../../hooks/useClients";
import { useDeleteScheduleSlot } from "../../hooks/useSchedule";
import { useDeletePersonalLesson, useDeletePersonalLessonSeriesFromDate, usePersonalLessons } from "../../hooks/usePersonalLessons";
import { useClosePersonalLessonOccurrence, useActivePersonalLessonClosure, useReopenLessonOccurrenceClosure } from "../../hooks/useVenueCosts";
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
import { personalLessonsInSeriesFromDate } from "../../lib/personalLessonSeries";
import { toISODateLocal } from "../../lib/scheduleWeek";
import { formatCurrency } from "../../lib/utils";
import { formatReopenLessonError } from "../../lib/venueCostDraftErrors";
import { personalLessonClientEntries } from "../../lib/personalLessonClients";
import type { DisplayLesson, GroupDisplayLesson, PersonalDisplayLesson } from "../../types";
import type { Client } from "../../types";
import ClientCardModal from "../ClientCardModal";
import ConfirmDialog from "../ui/ConfirmDialog";
import { btnAddCls, btnCancelCls, btnDestructiveCls, btnOpenCls } from "../ui/buttonStyles";
import RequirePermission from "../RequirePermission";
import PayPersonalLessonModal, { type PayPersonalLessonTarget } from "./PayPersonalLessonModal";
import MoveGroupLessonDialog from "./MoveGroupLessonDialog";
import CancelGroupLessonDialog from "./CancelGroupLessonDialog";
import GoogleCalendarSyncStatusBadge from "../integrations/GoogleCalendarSyncStatusBadge";
import { useGoogleCalendarSyncStatus } from "../../hooks/useGoogleCalendarSyncStatus";
import type { PersonalLessonRef, ScheduleSlotRef } from "../../lib/scheduleConflicts";

interface LessonInfoPopupProps {
  lesson: GroupDisplayLesson | PersonalDisplayLesson | null;
  locationName?: string;
  disciplineName?: string;
  teacherName?: string;
  scheduleSlots?: ScheduleSlotRef[];
  personalLessons?: PersonalLessonRef[];
  onClose: () => void;
  onEdit?: (lesson: GroupDisplayLesson | PersonalDisplayLesson) => void;
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
  scheduleSlots = [],
  personalLessons = [],
  onClose,
  onEdit,
  onSuccess,
  onPaymentSuccess,
}: LessonInfoPopupProps) {
  const { t, formatDate } = useI18n();
  const toast = useToast();
  const { memberId } = useOrganization();
  const { role, can, isReadOnly, canEditPastSchedule } = usePermissions();
  const deleteScheduleSlot = useDeleteScheduleSlot();
  const deletePersonalLesson = useDeletePersonalLesson();
  const deletePersonalLessonSeries = useDeletePersonalLessonSeriesFromDate();
  const closePersonalLesson = useClosePersonalLessonOccurrence();
  const reopenLessonClosure = useReopenLessonOccurrenceClosure();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [cancelOneConfirmOpen, setCancelOneConfirmOpen] = useState(false);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [payTarget, setPayTarget] = useState<PayPersonalLessonTarget | null>(null);
  const [profileClient, setProfileClient] = useState<Client | null>(null);
  const [reopenReason, setReopenReason] = useState("");
  const { data: directoryClients = [] } = useClientDirectory({
    enabled: lesson?.kind === "personal",
  });
  const personalLessonsQuery = usePersonalLessons({
    enabled: lesson?.kind === "personal",
    yearMonth: lesson?.kind === "personal" ? lesson.date.slice(0, 7) : undefined,
  });
  const personalClosureQuery = useActivePersonalLessonClosure(
    lesson?.kind === "personal" ? lesson.lessonId : null,
    lesson?.kind === "personal"
  );
  const googleSyncStatus = useGoogleCalendarSyncStatus(
    lesson?.kind === "personal" ? lesson.lessonId : null
  );
  const activePersonalClosure = personalClosureQuery.data ?? null;

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

  const personalClientEntries =
    lesson?.kind === "personal"
      ? personalLessonClientEntries(
          lesson,
          directoryClients,
          canReadClients,
          t("schedule.lessonInfo.clientNotSpecified")
        )
      : [];

  const openClientProfile = (entry: { id: string | null; client?: Client }) => {
    if (!entry.id || !canReadClients) return;
    const client = entry.client ?? directoryClients.find((c) => c.id === entry.id);
    if (client) setProfileClient(client);
  };

  const resolvedProfileClient = profileClient
    ? directoryClients.find((c) => c.id === profileClient.id) ?? profileClient
    : null;

  const canEdit =
    lesson &&
    (lesson.kind === "group"
      ? canManageGroupLesson(role, lesson.date, isReadOnly, canEditPastSchedule)
      : canWritePersonalLesson(role, memberId, lesson, can, isReadOnly, canEditPastSchedule));

  const canDelete = canEdit;

  const canCancelOneOccurrence =
    lesson?.kind === "group" &&
    canEdit &&
    isRecurringGroupSlot(lesson.validFrom, lesson.validTo);

  const canMoveOneOccurrence = canCancelOneOccurrence;

  const movedFromLabel =
    lesson?.kind === "group" && lesson.movedFromDate
      ? t("schedule.lessonInfo.movedFrom", {
          date: formatDate(lesson.movedFromDate),
          time: lesson.movedFromTime ?? lesson.timeStart,
        })
      : null;

  const canPay =
    lesson?.kind === "personal" &&
    canPayPersonalLesson(role, memberId, lesson, can, isReadOnly);

  const canClosePersonal =
    lesson?.kind === "personal" &&
    !isReadOnly &&
    lesson.date <= toISODateLocal(new Date()) &&
    !activePersonalClosure &&
    (can("personal_lessons.write", permissionContext) || can("finance.read"));

  const canReopenPersonal =
    lesson?.kind === "personal" && Boolean(activePersonalClosure) && can("finance.read");

  const fullPersonalLesson =
    lesson?.kind === "personal"
      ? personalLessonsQuery.data?.find((row) => row.id === lesson.lessonId)
      : undefined;

  const personalSeriesFromDate = useMemo(() => {
    if (!fullPersonalLesson || !personalLessonsQuery.data) return [];
    return personalLessonsInSeriesFromDate(fullPersonalLesson, personalLessonsQuery.data);
  }, [fullPersonalLesson, personalLessonsQuery.data]);

  const canDeletePersonalSeries = personalSeriesFromDate.length >= 2;

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
      clientId4: fullLesson.clientId4,
      clientDisplay: fullLesson.clientDisplay,
      payerClientId: fullLesson.payerClientId,
      priceId: fullLesson.priceId,
      price: fullLesson.price,
      paidAmount: fullLesson.paidAmount,
      locationId: fullLesson.locationId ?? null,
      disciplineId: fullLesson.disciplineId ?? null,
      teacherMemberId: fullLesson.teacherMemberId ?? null,
    });
  };

  const handleClosePersonal = async () => {
    if (lesson?.kind !== "personal") return;
    const res = await closePersonalLesson.mutateAsync({ personalLessonId: lesson.lessonId });
    if (res.success === false) {
      toast(t("venueCosts.closeLesson.error", { error: res.error }), "error");
      return;
    }
    if (res.amount != null) {
      toast(
        `${t("venueCosts.closeLesson.success")} · ${t("venueCosts.closeLesson.amount", {
          amount: formatCurrency(res.amount),
        })}`,
        "success"
      );
    } else {
      toast(t("venueCosts.closeLesson.success"), "success");
    }
    onSuccess?.();
  };

  const handleReopenPersonal = async () => {
    if (!activePersonalClosure) return;
    if (!reopenReason.trim()) {
      toast(formatReopenLessonError("reason_required", t), "error");
      return;
    }
    const res = await reopenLessonClosure.mutateAsync({
      closureId: activePersonalClosure.id,
      reason: reopenReason.trim(),
    });
    if (!res.success) {
      toast(formatReopenLessonError(res.error, t), "error");
      return;
    }
    setReopenReason("");
    toast(t("venueCosts.reopenLesson.success"), "success");
    onSuccess?.();
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

  const handleDeletePersonalSeries = async () => {
    if (!lesson || lesson.kind !== "personal") return;

    const res = await deletePersonalLessonSeries.mutateAsync({
      id: lesson.lessonId,
      lessonDate: lesson.date,
    });
    if (!res.success) {
      toast(res.error ?? t("schedule.error.deleteLessonFailed"), "error");
      return;
    }

    toast(
      t("schedule.success.personalSeriesDeleted", { count: res.deletedCount }),
      "success"
    );
    setDeleteConfirmOpen(false);
    onSuccess?.();
    onClose();
  };

  const deletePending =
    deleteScheduleSlot.isPending ||
    deletePersonalLesson.isPending ||
    deletePersonalLessonSeries.isPending;

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
                    <div className="min-w-0">
                      <dt className={detailLabelCls}>{t("common.clientsLabel")}</dt>
                      <dd className={`${detailValueCls} space-y-0.5`}>
                        {personalClientEntries.map((entry, index) =>
                          entry.id && canReadClients ? (
                            <button
                              key={entry.id}
                              type="button"
                              onClick={() => openClientProfile(entry)}
                              className="block text-left text-indigo-600 hover:text-indigo-700 hover:underline underline-offset-2 cursor-pointer transition-colors"
                            >
                              {entry.label}
                            </button>
                          ) : (
                            <span key={`${entry.label}-${index}`} className="block">
                              {entry.label}
                            </span>
                          )
                        )}
                      </dd>
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

                {movedFromLabel && (
                  <div className="rounded-lg border border-indigo-100 bg-indigo-50/70 px-3 py-2 text-xs text-indigo-800">
                    {movedFromLabel}
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

                {lesson.kind === "personal" && googleSyncStatus.uiStatus && (
                  <GoogleCalendarSyncStatusBadge
                    status={googleSyncStatus.uiStatus}
                    lastError={googleSyncStatus.row?.last_error}
                  />
                )}
              </dl>

              {canPay ? (
                <button
                  type="button"
                  onClick={handleOpenPay}
                  className={`w-full ${btnAddCls}`}
                >
                  <Coins className="w-4 h-4" />
                  {t("common.pay")}
                </button>
              ) : null}

              {canClosePersonal ? (
                <button
                  type="button"
                  onClick={() => void handleClosePersonal()}
                  disabled={closePersonalLesson.isPending}
                  className={`w-full ${btnAddCls}`}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {closePersonalLesson.isPending ? t("common.saving") : t("venueCosts.closeLesson")}
                </button>
              ) : null}

              {activePersonalClosure ? (
                <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3 space-y-2">
                  <p className="text-xs font-semibold text-slate-800">{t("venueCosts.closeLesson.closed")}</p>
                  {canReopenPersonal && (
                    <>
                      <label className="block space-y-1">
                        <span className="text-[10px] text-slate-500 font-sans uppercase tracking-wider">
                          {t("venueCosts.reopenLesson.reason")}
                        </span>
                        <input
                          type="text"
                          value={reopenReason}
                          onChange={(e) => setReopenReason(e.target.value)}
                          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:border-amber-400"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => void handleReopenPersonal()}
                        disabled={reopenLessonClosure.isPending}
                        className={`w-full ${btnOpenCls}`}
                      >
                        {reopenLessonClosure.isPending ? t("common.saving") : t("venueCosts.reopenLesson")}
                      </button>
                    </>
                  )}
                </div>
              ) : null}

              {canCancelOneOccurrence ? (
                <RequirePermission action="schedule.write" context={permissionContext}>
                  <button
                    type="button"
                    onClick={() => setCancelOneConfirmOpen(true)}
                    className={`w-full ${btnDestructiveCls}`}
                  >
                    <XCircle className="w-4 h-4" />
                    {t("schedule.lessonInfo.cancelOne")}
                  </button>
                </RequirePermission>
              ) : null}

              {canMoveOneOccurrence ? (
                <RequirePermission action="schedule.write" context={permissionContext}>
                  <button
                    type="button"
                    onClick={() => setMoveDialogOpen(true)}
                    className={`w-full ${btnOpenCls}`}
                  >
                    <ArrowRightLeft className="w-4 h-4" />
                    {t("schedule.lessonInfo.moveOne")}
                  </button>
                </RequirePermission>
              ) : null}

              <div className="flex items-center gap-2 pt-1">
                {canEdit && (
                  <RequirePermission action={lesson.kind === "group" ? "schedule.write" : "personal_lessons.write"} context={permissionContext}>
                    <button
                      type="button"
                      onClick={() => onEdit?.(lesson)}
                      className={`flex-1 ${btnAddCls}`}
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
                  className={`flex-1 ${btnCancelCls}`}
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
        alternateConfirmLabel={
          lesson?.kind === "personal" && canDeletePersonalSeries
            ? t("schedule.lessonInfo.deletePersonalSeriesConfirm", {
                count: personalSeriesFromDate.length,
              })
            : undefined
        }
        alternatePending={deletePersonalLessonSeries.isPending}
        onAlternateConfirm={
          lesson?.kind === "personal" && canDeletePersonalSeries ? handleDeletePersonalSeries : undefined
        }
      />

      <CancelGroupLessonDialog
        lesson={cancelOneConfirmOpen && lesson?.kind === "group" ? lesson : null}
        disciplineName={disciplineName}
        toast={toast}
        onClose={() => setCancelOneConfirmOpen(false)}
        onSuccess={() => {
          setCancelOneConfirmOpen(false);
          onSuccess?.();
          onClose();
        }}
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

      <MoveGroupLessonDialog
        lesson={moveDialogOpen && lesson?.kind === "group" ? lesson : null}
        locationName={locationName}
        disciplineName={disciplineName}
        teacherName={teacherName}
        scheduleSlots={scheduleSlots}
        personalLessons={personalLessons}
        toast={toast}
        onClose={() => setMoveDialogOpen(false)}
        onSuccess={() => {
          setMoveDialogOpen(false);
          onSuccess?.();
          onClose();
        }}
      />

      <ClientCardModal
        client={resolvedProfileClient}
        onClose={() => setProfileClient(null)}
        toast={toast}
        stackLayer="above"
      />
    </>
  );
}
