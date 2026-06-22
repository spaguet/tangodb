import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarDays, Info, MapPin, Trash2, User, X } from "lucide-react";
import { useAddGroupSchedule, useDeleteScheduleSlot, useEditGroupSchedule } from "../../hooks/useSchedule";
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
import { addDays, getWeekRange, isPastDate, toISODateLocal } from "../../lib/scheduleWeek";
import { canReadLessonClients, maskClientDisplay } from "../../lib/scheduleLessonAccess";
import { dowFullEntries, formatDateRu, jsDayToIsoDow, timesOverlap } from "../../lib/utils";
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

const addDayBtnCls =
  "w-full py-2 bg-slate-50 border border-dashed border-slate-300 hover:border-slate-400 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors font-sans text-xs font-semibold uppercase tracking-wider cursor-pointer";

interface GroupSlotRow {
  key: string;
  id?: string;
  dayOfWeek: number;
  timeStart: string;
  timeEnd: string;
}

function dateForDayOfWeekInWeek(baseDate: string, dayOfWeek: number): string {
  const { weekStart } = getWeekRange(new Date(`${baseDate}T12:00:00`));
  for (let offset = 0; offset < 7; offset += 1) {
    const date = addDays(toISODateLocal(weekStart), offset);
    const dow = jsDayToIsoDow(new Date(`${date}T12:00:00`).getDay());
    if (dow === dayOfWeek) return date;
  }
  return baseDate;
}

function makeGroupSlotRow(dayOfWeek = 1, timeStart = "19:00", timeEnd = "20:00"): GroupSlotRow {
  return { key: crypto.randomUUID(), dayOfWeek, timeStart, timeEnd };
}

function findInternalSlotConflict(rows: GroupSlotRow[], rowKey: string): string | null {
  const row = rows.find((item) => item.key === rowKey);
  if (!row) return null;

  for (const other of rows) {
    if (other.key === rowKey) continue;
    if (other.dayOfWeek !== row.dayOfWeek) continue;
    if (timesOverlap(row.timeStart, row.timeEnd, other.timeStart, other.timeEnd)) {
      return "этот день и время уже добавлены в форму";
    }
  }

  return null;
}

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
  const addGroupSchedule = useAddGroupSchedule();
  const deleteScheduleSlot = useDeleteScheduleSlot();
  const updatePersonalLesson = useUpdatePersonalLesson();

  const isTeacher = role === "teacher";
  const todayISO = toISODateLocal(new Date());

  const [groupName, setGroupName] = useState("");
  const [disciplineId, setDisciplineId] = useState("");
  const [teacherMemberId, setTeacherMemberId] = useState("");
  const [timeStart, setTimeStart] = useState("19:00");
  const [timeEnd, setTimeEnd] = useState("20:00");
  const [personalDate, setPersonalDate] = useState("");
  const [groupSlotRows, setGroupSlotRows] = useState<GroupSlotRow[]>([]);
  const [originalGroupSlots, setOriginalGroupSlots] = useState<GroupSlotRow[]>([]);

  useEffect(() => {
    if (!lesson) return;
    if (lesson.kind === "group") {
      setGroupName(lesson.groupName?.trim() ?? "");
      setDisciplineId(lesson.disciplineId ?? "");
      setTeacherMemberId(lesson.teacherMemberId ?? "");
      setTimeStart(lesson.timeStart);
      setTimeEnd(lesson.timeEnd);

      const siblingSlots = scheduleSlots.filter((slot) => {
        if ((slot.locationId ?? null) !== lesson.locationId) return false;
        if ((slot.disciplineId ?? null) !== lesson.disciplineId) return false;
        if ((slot.groupName ?? "").trim() !== (lesson.groupName ?? "").trim()) return false;
        const validFrom = slot.validFrom ?? "2000-01-01";
        if (validFrom > lesson.date) return false;
        if (slot.validTo != null && slot.validTo < lesson.date) return false;
        return true;
      });

      const rows =
        siblingSlots.length > 0
          ? siblingSlots.map((slot) => ({
              key: slot.id ?? `${slot.dayOfWeek}-${slot.time}`,
              id: slot.id,
              dayOfWeek: slot.dayOfWeek,
              timeStart: slot.time,
              timeEnd: slot.timeEnd,
            }))
          : [
              {
                key: lesson.slotId,
                id: lesson.slotId,
                dayOfWeek: lesson.dayOfWeek,
                timeStart: lesson.timeStart,
                timeEnd: lesson.timeEnd,
              },
            ];

      setGroupSlotRows(rows);
      setOriginalGroupSlots(rows.map((row) => ({ ...row })));
    } else {
      setPersonalDate(lesson.date);
      setDisciplineId(lesson.disciplineId ?? "");
      setTeacherMemberId(lesson.teacherMemberId ?? "");
      setTimeStart(lesson.timeStart);
      setTimeEnd(lesson.timeEnd);
    }
  }, [lesson, scheduleSlots]);

  const updateGroupSlotRow = (key: string, patch: Partial<GroupSlotRow>) => {
    setGroupSlotRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const handleGroupSlotTimeStartChange = (key: string, next: string) => {
    setGroupSlotRows((prev) =>
      prev.map((row) => {
        if (row.key !== key) return row;
        return { ...row, timeStart: next, timeEnd: computeAutoTimeEnd(next, []) };
      })
    );
  };

  const handleAddGroupDay = () => {
    setGroupSlotRows((prev) => [...prev, makeGroupSlotRow()]);
  };

  const handleRemoveGroupDay = (key: string) => {
    setGroupSlotRows((prev) => (prev.length <= 1 ? prev : prev.filter((row) => row.key !== key)));
  };

  const groupSlotConflicts = useMemo(() => {
    if (!lesson || lesson.kind !== "group") return new Map<string, string>();

    const conflicts = new Map<string, string>();
    for (const row of groupSlotRows) {
      const internal = findInternalSlotConflict(groupSlotRows, row.key);
      if (internal) {
        conflicts.set(row.key, internal);
        continue;
      }

      const rangeError = validateTimeRange(row.timeStart, row.timeEnd);
      if (rangeError) {
        conflicts.set(row.key, rangeError);
        continue;
      }

      const conflictDate = dateForDayOfWeekInWeek(lesson.date, row.dayOfWeek);
      const external = findScheduleConflict(
        {
          date: conflictDate,
          timeStart: row.timeStart,
          timeEnd: row.timeEnd,
          locationId: lesson.locationId,
          excludeSlotId: row.id,
        },
        personalLessons,
        scheduleSlots
      );
      if (external) {
        conflicts.set(row.key, external);
      }
    }

    return conflicts;
  }, [lesson, groupSlotRows, personalLessons, scheduleSlots]);

  const hasGroupSlotConflicts = groupSlotConflicts.size > 0;

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
    if (hasGroupSlotConflicts) {
      toast("Исправьте конфликты в расписании перед сохранением", "error");
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

    const metadataChanged =
      trimmedGroup !== (lesson.groupName?.trim() ?? "") ||
      disciplineId !== (lesson.disciplineId ?? "") ||
      teacherMemberId !== (lesson.teacherMemberId ?? "");

    const currentIds = new Set(groupSlotRows.map((row) => row.id).filter(Boolean));
    const removedSlots = originalGroupSlots.filter((row) => row.id && !currentIds.has(row.id));

    for (const row of groupSlotRows) {
      if (!row.id) continue;
      const original = originalGroupSlots.find((item) => item.id === row.id);
      const slotChanged =
        !original ||
        original.dayOfWeek !== row.dayOfWeek ||
        original.timeStart !== row.timeStart ||
        original.timeEnd !== row.timeEnd;

      if (!slotChanged && !metadataChanged) continue;

      const res = await editGroupSchedule.mutateAsync({
        slotId: row.id,
        editDate: lesson.date,
        dayOfWeek: row.dayOfWeek,
        time: row.timeStart,
        timeEnd: row.timeEnd,
        groupName: trimmedGroup,
        disciplineId,
        locationId: lesson.locationId,
        teacherMemberId,
      });

      if (!res.success) {
        toast(res.error ?? "Не удалось сохранить изменения", "error");
        return;
      }
    }

    for (const row of removedSlots) {
      if (!row.id) continue;
      const res = await deleteScheduleSlot.mutateAsync({ id: row.id, editDate: lesson.date });
      if (!res.success) {
        toast(res.error ?? "Не удалось удалить занятие из расписания", "error");
        return;
      }
    }

    const newRows = groupSlotRows.filter((row) => !row.id);
    if (newRows.length > 0) {
      const res = await addGroupSchedule.mutateAsync({
        groupName: trimmedGroup,
        disciplineId,
        locationId: lesson.locationId,
        teacherMemberId,
        days: newRows.map((row) => ({
          dayOfWeek: row.dayOfWeek,
          time: row.timeStart,
          timeEnd: row.timeEnd,
        })),
      });

      if (!res.success) {
        toast(res.error ?? "Не удалось добавить занятие в расписание", "error");
        return;
      }
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

  const savePending =
    editGroupSchedule.isPending ||
    addGroupSchedule.isPending ||
    deleteScheduleSlot.isPending ||
    updatePersonalLesson.isPending;
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
                      <label className={labelCls}>Текущая дата занятия</label>
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

                    <div className="field-stack">
                      <label className={labelCls}>Дни и время</label>
                      <div className="space-y-2">
                        {groupSlotRows.map((row) => {
                          const conflict = groupSlotConflicts.get(row.key);
                          return (
                            <div
                              key={row.key}
                              className="p-3 bg-slate-50 rounded-lg border border-slate-100 space-y-2"
                            >
                              <div className="flex items-start gap-2">
                                <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
                                  <AppSelect
                                    value={row.dayOfWeek}
                                    onChange={(e) =>
                                      updateGroupSlotRow(row.key, {
                                        dayOfWeek: parseInt(e.target.value, 10),
                                      })
                                    }
                                    className="text-xs py-2"
                                  >
                                    {dowFullEntries().map(([val, name]) => (
                                      <option key={val} value={val}>
                                        {name}
                                      </option>
                                    ))}
                                  </AppSelect>
                                  <TimeSelect
                                    label=""
                                    value={row.timeStart}
                                    onChange={(next) => handleGroupSlotTimeStartChange(row.key, next)}
                                    required
                                  />
                                  <TimeSelect
                                    label=""
                                    value={row.timeEnd}
                                    onChange={(next) => updateGroupSlotRow(row.key, { timeEnd: next })}
                                    required
                                  />
                                </div>
                                {groupSlotRows.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveGroupDay(row.key)}
                                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all cursor-pointer shrink-0 mt-1"
                                    title="Убрать день"
                                    aria-label="Убрать день"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                )}
                              </div>
                              {conflict && (
                                <p className="text-[10px] text-rose-600 font-sans">
                                  Конфликт: {conflict}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <button type="button" onClick={handleAddGroupDay} className={addDayBtnCls}>
                        ＋ Добавить день
                      </button>
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
                    disabled={
                      connectionState !== "online" ||
                      savePending ||
                      (lesson.kind === "group" && hasGroupSlotConflicts)
                    }
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
