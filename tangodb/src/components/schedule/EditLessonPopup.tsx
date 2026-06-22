import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarDays, Info, MapPin, User, X } from "lucide-react";
import { useEditGroupSchedule } from "../../hooks/useSchedule";
import { useUpdatePersonalLesson } from "../../hooks/usePersonalLessons";
import { useOrganization } from "../../organization/OrganizationProvider";
import { usePermissions } from "../../hooks/usePermissions";
import { memberDisplayName, memberListLabel, type TeamMemberRow } from "../../hooks/useTeamMembers";
import {
  getConnectionBlockReason,
  getMutationBlockedMessage,
  useOnlineStatus,
} from "../../hooks/useOnlineStatus";
import { findScheduleConflict } from "../../lib/scheduleConflicts";
import { computeAutoTimeEnd, validateTimeRange } from "../../lib/scheduleTime";
import { addDays, isPastDate, toISODateLocal } from "../../lib/scheduleWeek";
import { canReadLessonClients, maskClientDisplay } from "../../lib/scheduleLessonAccess";
import { formatDateRu, jsDayToIsoDow } from "../../lib/utils";
import type { Discipline, DisplayLesson } from "../../types";
import AppSelect from "../ui/AppSelect";
import DisciplineSelect from "../ui/DisciplineSelect";
import RequirePermission from "../RequirePermission";
import TimeSelect from "../ui/TimeSelect";

interface EditLessonPopupProps {
  lesson: DisplayLesson | null;
  locationName?: string;
  disciplines: Discipline[];
  teacherOptions: TeamMemberRow[];
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

const fieldCls =
  "w-full bg-slate-50 border border-slate-200 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none rounded-lg px-3.5 py-2.5 text-sm transition-all";
const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";
const readOnlyCls =
  "flex items-center gap-2 px-3.5 py-2.5 bg-slate-100 border border-slate-200 rounded-lg text-sm text-slate-700";

export default function EditLessonPopup({
  lesson,
  locationName,
  disciplines,
  teacherOptions,
  scheduleSlots,
  personalLessons,
  toast,
  onClose,
  onSuccess,
}: EditLessonPopupProps) {
  const { memberId } = useOrganization();
  const { role, can } = usePermissions();
  const { connectionState } = useOnlineStatus();
  const editGroupSchedule = useEditGroupSchedule();
  const updatePersonalLesson = useUpdatePersonalLesson();

  const isTeacher = role === "teacher";
  const todayISO = toISODateLocal(new Date());

  const [groupName, setGroupName] = useState("");
  const [disciplineId, setDisciplineId] = useState("");
  const [teacherMemberId, setTeacherMemberId] = useState("");
  const [timeStart, setTimeStart] = useState("19:00");
  const [timeEnd, setTimeEnd] = useState("20:00");
  const [personalDate, setPersonalDate] = useState("");

  useEffect(() => {
    if (!lesson) return;
    if (lesson.kind === "group") {
      setGroupName(lesson.groupName?.trim() ?? "");
      setDisciplineId(lesson.disciplineId ?? "");
      setTeacherMemberId(lesson.teacherMemberId ?? "");
      setTimeStart(lesson.timeStart);
      setTimeEnd(lesson.timeEnd);
    } else {
      setPersonalDate(lesson.date);
      setDisciplineId(lesson.disciplineId ?? "");
      setTeacherMemberId(lesson.teacherMemberId ?? "");
      setTimeStart(lesson.timeStart);
      setTimeEnd(lesson.timeEnd);
    }
  }, [lesson]);

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

  const sameDayLessons = useMemo(() => {
    if (!lesson) return [];
    const targetDate = lesson.kind === "personal" ? personalDate : lesson.date;
    const locationId = lesson.locationId;
    const dayOfWeek =
      lesson.kind === "group"
        ? lesson.dayOfWeek
        : jsDayToIsoDow(new Date(`${personalDate}T12:00:00`).getDay());

    const groupIntervals = scheduleSlots
      .filter((s) => {
        if (s.locationId !== locationId) return false;
        if (s.dayOfWeek !== dayOfWeek) return false;
        if (lesson.kind === "group" && s.id === lesson.slotId) return false;
        return true;
      })
      .map((s) => ({ timeStart: s.time, timeEnd: s.timeEnd }));

    const personalIntervals = personalLessons
      .filter((l) => l.date === targetDate && l.locationId === locationId)
      .filter((l) => lesson.kind !== "personal" || l.id !== lesson.lessonId)
      .map((l) => ({ timeStart: l.timeStart, timeEnd: l.timeEnd }));

    return [...groupIntervals, ...personalIntervals];
  }, [lesson, personalDate, scheduleSlots, personalLessons]);

  const handleTimeStartChange = (next: string) => {
    setTimeStart(next);
    setTimeEnd(computeAutoTimeEnd(next, sameDayLessons));
  };

  const handleSaveGroup = async () => {
    if (!lesson || lesson.kind !== "group") return;
    if (connectionState !== "online") {
      toast(getMutationBlockedMessage(connectionState), "error");
      return;
    }
    if (isPastDate(lesson.date)) {
      toast("Нельзя редактировать занятие в прошлом", "error");
      return;
    }

    const trimmedGroup = groupName.trim();
    if (!trimmedGroup) {
      toast("Укажите название группы.", "error");
      return;
    }
    if (!disciplineId) {
      toast("Выберите дисциплину.", "error");
      return;
    }
    if (!teacherMemberId) {
      toast("Выберите преподавателя.", "error");
      return;
    }

    const rangeError = validateTimeRange(timeStart, timeEnd);
    if (rangeError) {
      toast(rangeError, "error");
      return;
    }

    const conflict = findScheduleConflict(
      {
        date: lesson.date,
        timeStart,
        timeEnd,
        locationId: lesson.locationId,
        excludeSlotId: lesson.slotId,
      },
      personalLessons,
      scheduleSlots
    );
    if (conflict) {
      toast(`Конфликт: ${formatDateRu(lesson.date)} ${timeStart} — ${conflict}`, "error");
      return;
    }

    const res = await editGroupSchedule.mutateAsync({
      slotId: lesson.slotId,
      editDate: lesson.date,
      dayOfWeek: lesson.dayOfWeek,
      time: timeStart,
      timeEnd,
      groupName: trimmedGroup,
      disciplineId,
      locationId: lesson.locationId,
      teacherMemberId,
    });

    if (!res.success) {
      toast(res.error ?? "Не удалось сохранить изменения", "error");
      return;
    }

    toast("Групповое занятие обновлено", "success");
    onSuccess();
    onClose();
  };

  const handleSavePersonal = async () => {
    if (!lesson || lesson.kind !== "personal") return;
    if (connectionState !== "online") {
      toast(getMutationBlockedMessage(connectionState), "error");
      return;
    }
    if (isPastDate(lesson.date)) {
      toast("Нельзя редактировать урок в прошлом", "error");
      return;
    }
    if (!personalDate) {
      toast("Укажите дату урока.", "error");
      return;
    }
    if (isPastDate(personalDate)) {
      toast("Нельзя перенести урок в прошлое", "error");
      return;
    }
    if (!disciplineId) {
      toast("Выберите дисциплину.", "error");
      return;
    }
    if (!teacherMemberId) {
      toast("Выберите преподавателя.", "error");
      return;
    }

    const rangeError = validateTimeRange(timeStart, timeEnd);
    if (rangeError) {
      toast(rangeError, "error");
      return;
    }

    const conflict = findScheduleConflict(
      {
        date: personalDate,
        timeStart,
        timeEnd,
        locationId: lesson.locationId,
        excludeLessonId: lesson.lessonId,
      },
      personalLessons,
      scheduleSlots
    );
    if (conflict) {
      toast(`Конфликт: ${formatDateRu(personalDate)} ${timeStart} — ${conflict}`, "error");
      return;
    }

    const res = await updatePersonalLesson.mutateAsync({
      id: lesson.lessonId,
      date: personalDate,
      timeStart,
      timeEnd,
      disciplineId,
      teacherMemberId,
      locationId: lesson.locationId,
    });

    if (!res.success) {
      toast(res.error ?? "Не удалось сохранить изменения", "error");
      return;
    }

    toast("Персональный урок обновлён", "success");
    onSuccess();
    onClose();
  };

  const groupVersionNote =
    lesson?.kind === "group"
      ? `Новая версия начнёт действовать с ${formatDateRu(addDays(lesson.date, 1))}. До этого отображается текущая версия.`
      : null;

  const personalEditNote =
    "Клиенты и оплата в этом окне не редактируются — только дата, время, направление и преподаватель.";

  const savePending = editGroupSchedule.isPending || updatePersonalLesson.isPending;
  const readOnly = lesson ? isPastDate(lesson.date) : false;

  return (
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
            className="relative bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden max-w-md w-full max-h-[90vh] overflow-y-auto p-4 panel-card-stack"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-500">
                  {lesson.kind === "group" ? "Групповой урок" : "Персональный урок"}
                </p>
                <h3 className="text-base font-semibold tracking-tight text-slate-900">Редактирование</h3>
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

            {readOnly ? (
              <p className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5">
                Занятия в прошлом доступны только для просмотра.
              </p>
            ) : (
              <div className="panel-form-stack">
                {locationName && (
                  <div className="field-stack">
                    <label className={labelCls}>Локация</label>
                    <div className={readOnlyCls}>
                      <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
                      {locationName}
                    </div>
                  </div>
                )}

                {lesson.kind === "group" ? (
                  <>
                    <div className="field-stack">
                      <label className={labelCls}>День</label>
                      <div className={readOnlyCls}>
                        <CalendarDays className="w-4 h-4 text-slate-400 shrink-0" />
                        {formatDateRu(lesson.date)}
                      </div>
                    </div>

                    <div className="field-stack">
                      <label className={labelCls}>Название группы</label>
                      <input
                        type="text"
                        required
                        value={groupName}
                        onChange={(e) => setGroupName(e.target.value)}
                        className={fieldCls}
                      />
                    </div>

                    <DisciplineSelect
                      disciplines={disciplines}
                      value={disciplineId}
                      onChange={setDisciplineId}
                      toast={toast}
                    />

                    <AppSelect
                      label="Преподаватель"
                      value={teacherMemberId}
                      onChange={(e) => setTeacherMemberId(e.target.value)}
                      required
                    >
                      {teacherOptions.length === 0 ? (
                        <option value="">Нет преподавателей</option>
                      ) : (
                        teacherOptions.map((member) => (
                          <option key={member.id} value={member.id}>
                            {memberDisplayName(member) ?? memberListLabel(member)}
                          </option>
                        ))
                      )}
                    </AppSelect>

                    <div className="grid grid-cols-2 gap-3">
                      <TimeSelect label="Начало" value={timeStart} onChange={handleTimeStartChange} required />
                      <TimeSelect label="Окончание" value={timeEnd} onChange={setTimeEnd} required />
                    </div>

                    {groupVersionNote && (
                      <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
                        <Info className="w-4 h-4 shrink-0 mt-0.5" />
                        <p>{groupVersionNote}</p>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="field-stack">
                      <label className={labelCls}>Клиент(ы)</label>
                      <div className={readOnlyCls}>
                        <User className="w-4 h-4 text-slate-400 shrink-0" />
                        {clientLabel}
                      </div>
                    </div>

                    <div className="field-stack">
                      <label className={labelCls} htmlFor="edit-lesson-date">
                        Дата
                      </label>
                      <input
                        id="edit-lesson-date"
                        type="date"
                        required
                        min={todayISO}
                        value={personalDate}
                        onChange={(e) => setPersonalDate(e.target.value)}
                        className={fieldCls}
                      />
                    </div>

                    <DisciplineSelect
                      disciplines={disciplines}
                      value={disciplineId}
                      onChange={setDisciplineId}
                      toast={toast}
                    />

                    {!isTeacher && (
                      <AppSelect
                        label="Преподаватель"
                        value={teacherMemberId}
                        onChange={(e) => setTeacherMemberId(e.target.value)}
                        required
                      >
                        {teacherOptions.length === 0 ? (
                          <option value="">Нет преподавателей</option>
                        ) : (
                          teacherOptions.map((member) => (
                            <option key={member.id} value={member.id}>
                              {memberDisplayName(member) ?? memberListLabel(member)}
                            </option>
                          ))
                        )}
                      </AppSelect>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      <TimeSelect label="Начало" value={timeStart} onChange={handleTimeStartChange} required />
                      <TimeSelect label="Окончание" value={timeEnd} onChange={setTimeEnd} required />
                    </div>

                    <p className="text-xs text-slate-500 leading-relaxed">{personalEditNote}</p>
                  </>
                )}
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              {!readOnly && (
                <RequirePermission
                  action={lesson.kind === "group" ? "schedule.write" : "personal_lessons.write"}
                  context={permissionContext}
                >
                  <button
                    type="button"
                    onClick={lesson.kind === "group" ? handleSaveGroup : handleSavePersonal}
                    disabled={connectionState !== "online" || savePending}
                    title={getConnectionBlockReason(connectionState)}
                    className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold uppercase tracking-wider rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {savePending ? "Сохранение…" : "Сохранить"}
                  </button>
                </RequirePermission>
              )}
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold uppercase tracking-wider rounded-lg transition-colors cursor-pointer"
              >
                {readOnly ? "Закрыть" : "Отмена"}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
