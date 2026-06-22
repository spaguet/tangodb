import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarDays, Clock, Edit, Layers, MapPin, Trash2, User, X } from "lucide-react";
import { useDeleteScheduleSlot } from "../../hooks/useSchedule";
import { useDeletePersonalLesson } from "../../hooks/usePersonalLessons";
import { usePermissions } from "../../hooks/usePermissions";
import { useOrganization } from "../../organization/OrganizationProvider";
import { useToast } from "../../App";
import {
  canManageGroupLesson,
  canReadLessonClients,
  canShowPaidStatus,
  canWritePersonalLesson,
  maskClientDisplay,
} from "../../lib/scheduleLessonAccess";
import { formatDateRu } from "../../lib/utils";
import type { DisplayLesson } from "../../types";
import ConfirmDialog from "../ui/ConfirmDialog";
import RequirePermission from "../RequirePermission";

interface LessonInfoPopupProps {
  lesson: DisplayLesson | null;
  locationName?: string;
  disciplineName?: string;
  teacherName?: string;
  onClose: () => void;
  onEdit?: (lesson: DisplayLesson) => void;
}

const detailLabelCls = "text-[10px] font-semibold uppercase tracking-wider text-slate-400";
const detailValueCls = "text-sm text-slate-800";

function lessonTitle(
  lesson: DisplayLesson,
  disciplineName: string | undefined,
  clientLabel: string
): string {
  if (lesson.kind === "group") {
    const groupLabel = lesson.groupName?.trim();
    if (groupLabel) return groupLabel;
    return disciplineName ?? "Групповой урок";
  }
  return clientLabel !== "Клиент не указан" && clientLabel !== "Клиент" ? clientLabel : "Персональный урок";
}

export default function LessonInfoPopup({
  lesson,
  locationName,
  disciplineName,
  teacherName,
  onClose,
  onEdit,
}: LessonInfoPopupProps) {
  const toast = useToast();
  const { memberId } = useOrganization();
  const { role, can, isReadOnly } = usePermissions();
  const deleteScheduleSlot = useDeleteScheduleSlot();
  const deletePersonalLesson = useDeletePersonalLesson();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

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

  const handleDelete = async () => {
    if (!lesson) return;

    if (lesson.kind === "group") {
      const res = await deleteScheduleSlot.mutateAsync({ id: lesson.slotId, editDate: lesson.date });
      if (!res.success) {
        toast(res.error ?? "Не удалось удалить занятие", "error");
        return;
      }
      toast("Групповое занятие удалено из расписания", "success");
    } else {
      const res = await deletePersonalLesson.mutateAsync(lesson.lessonId);
      if (!res.success) {
        toast(res.error ?? "Не удалось удалить урок", "error");
        return;
      }
      toast("Персональный урок удалён", "success");
    }

    setDeleteConfirmOpen(false);
    onClose();
  };

  const deletePending = deleteScheduleSlot.isPending || deletePersonalLesson.isPending;

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
                    {lesson.kind === "group" ? "Групповой урок" : "Персональный урок"}
                  </p>
                  <h3 className="text-base font-semibold tracking-tight text-slate-900 break-words">
                    {lessonTitle(lesson, disciplineName, clientLabel)}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Закрыть"
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
                      <dt className={detailLabelCls}>Клиент(ы)</dt>
                      <dd className={detailValueCls}>{clientLabel}</dd>
                    </div>
                  </div>
                )}

                {disciplineName && (
                  <div className="flex items-start gap-2.5">
                    <Layers className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                    <div>
                      <dt className={detailLabelCls}>Направление</dt>
                      <dd className={detailValueCls}>{disciplineName}</dd>
                    </div>
                  </div>
                )}

                <div className="flex items-start gap-2.5">
                  <CalendarDays className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                  <div>
                    <dt className={detailLabelCls}>Дата</dt>
                    <dd className={detailValueCls}>{formatDateRu(lesson.date)}</dd>
                  </div>
                </div>

                <div className="flex items-start gap-2.5">
                  <Clock className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                  <div>
                    <dt className={detailLabelCls}>Время</dt>
                    <dd className={detailValueCls}>
                      {lesson.timeStart} – {lesson.timeEnd}
                    </dd>
                  </div>
                </div>

                {locationName && (
                  <div className="flex items-start gap-2.5">
                    <MapPin className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                    <div>
                      <dt className={detailLabelCls}>Локация</dt>
                      <dd className={detailValueCls}>{locationName}</dd>
                    </div>
                  </div>
                )}

                {teacherName && (
                  <div className="flex items-start gap-2.5">
                    <User className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                    <div>
                      <dt className={detailLabelCls}>Преподаватель</dt>
                      <dd className={detailValueCls}>{teacherName}</dd>
                    </div>
                  </div>
                )}

                {lesson.kind === "personal" && canShowPaidStatus(role) && (
                  <div className="flex items-start gap-2.5">
                    <Clock className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                    <div>
                      <dt className={detailLabelCls}>Оплата</dt>
                      <dd className={detailValueCls}>
                        {lesson.paid === "yes" ? (
                          <span className="text-slate-600">Оплачен</span>
                        ) : (
                          <span className="text-rose-600">Не оплачен</span>
                        )}
                      </dd>
                    </div>
                  </div>
                )}
              </dl>

              <div className="flex items-center gap-2 pt-1">
                {canEdit && (
                  <RequirePermission action={lesson.kind === "group" ? "schedule.write" : "personal_lessons.write"} context={permissionContext}>
                    <button
                      type="button"
                      onClick={() => onEdit?.(lesson)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold uppercase tracking-wider rounded-lg transition-colors cursor-pointer"
                    >
                      <Edit className="w-3.5 h-3.5" />
                      Изменить
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
                      Удалить
                    </button>
                  </RequirePermission>
                )}

                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold uppercase tracking-wider rounded-lg transition-colors cursor-pointer"
                >
                  Закрыть
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={deleteConfirmOpen && lesson !== null}
        title={lesson?.kind === "group" ? "Удалить групповое занятие?" : "Удалить персональный урок?"}
        description={
          lesson ? (
            lesson.kind === "group" ? (
              <>
                Занятие{" "}
                <strong className="font-semibold text-slate-800">
                  {lessonTitle(lesson, disciplineName, clientLabel)}
                </strong>{" "}
                {formatDateRu(lesson.date)} ({lesson.timeStart} – {lesson.timeEnd}) будет убрано из расписания начиная
                с этой даты.
              </>
            ) : (
              <>
                Урок{" "}
                <strong className="font-semibold text-slate-800">{clientLabel}</strong> от{" "}
                {formatDateRu(lesson.date)} будет удалён безвозвратно.
              </>
            )
          ) : (
            ""
          )
        }
        confirmLabel="Удалить"
        pending={deletePending}
        onConfirm={handleDelete}
        onCancel={() => setDeleteConfirmOpen(false)}
      />
    </>
  );
}
