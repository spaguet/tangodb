/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarDays, Clock, Trash2, CalendarRange, Edit, X } from "lucide-react";
import {
  useAddGroupSchedule,
  useDeleteGroupSchedule,
  useDeleteScheduleSlot,
  useReplaceGroupSchedule,
  useSchedule,
  type GroupScheduleSlotInput,
} from "../hooks/useSchedule";
import { useDisciplines } from "../hooks/useDisciplines";
import { useLocations } from "../hooks/useLocations";
import { useTeamMembers, memberRoleLabel, memberDisplayName } from "../hooks/useTeamMembers";
import { usePersonalLessons } from "../hooks/usePersonalLessons";
import { dowFull, dowFullEntries, jsDayToIsoDow, timesOverlap } from "../lib/utils";
import ConfirmDialog from "./ui/ConfirmDialog";
import RequirePermission from "./RequirePermission";
import AppSelect, { fieldCls } from "./ui/AppSelect";
import DisciplineSelect from "./ui/DisciplineSelect";
import LoadingState from "./ui/LoadingState";
import QueryErrorState from "./ui/QueryErrorState";
import { usePermissions } from "../hooks/usePermissions";
import type { ToastType } from "../App";
import type { PersonalLesson, ScheduleSlot } from "../types";

interface SchedulePanelProps {
  toast: (msg: string, type?: ToastType) => void;
}

interface EditSlotRow extends GroupScheduleSlotInput {
  key: string;
}

interface DayFormRow {
  key: string;
  day: number;
  time: string;
  timeEnd: string;
}

interface ScheduleGroup {
  groupKey: string;
  groupName: string;
  disciplineId: string | null;
  locationId: string | null;
  teacherMemberId: string | null;
  displayName: string;
  disciplineLabel: string;
  locationLabel: string;
  teacherLabel: string;
  slots: ScheduleSlot[];
}

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

const iconBtnCls =
  "p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all cursor-pointer";

const deleteBtnCls =
  "p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all cursor-pointer";

const addDayBtnCls =
  "w-full py-2 bg-slate-50 border border-dashed border-slate-300 hover:border-slate-400 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors font-sans text-xs font-semibold uppercase tracking-wider cursor-pointer";

function makeDayRow(): DayFormRow {
  return { key: crypto.randomUUID(), day: 1, time: "19:00", timeEnd: "21:00" };
}

function scheduleGroupKey(slot: ScheduleSlot): string {
  const locationId = slot.locationId ?? "none";
  const groupName = slot.groupName ?? "";
  const disciplineId = slot.disciplineId ?? "none";
  return `${locationId}::${groupName}::${disciplineId}`;
}

function getSlotConflict(
  slot: EditSlotRow,
  disciplineId: string,
  locationId: string | null,
  allSchedule: ScheduleSlot[],
  personalLessons: PersonalLesson[],
  editSlotIds: Set<string | undefined>
): string | null {
  for (const s of allSchedule) {
    if (slot.id != null && s.id === slot.id) continue;
    if (editSlotIds.has(s.id) && s.disciplineId === disciplineId) continue;
    if ((s.locationId ?? null) !== locationId) continue;
    if (s.dayOfWeek !== slot.dayOfWeek) continue;
    if (!timesOverlap(slot.time, slot.timeEnd, s.time, s.timeEnd || "21:00")) continue;
    return "в это время уже записан другой групповой урок";
  }

  for (const lesson of personalLessons) {
    if ((lesson.locationId ?? null) !== locationId) continue;
    const lessonDow = jsDayToIsoDow(new Date(lesson.date).getDay());
    if (lessonDow !== slot.dayOfWeek) continue;
    if (!timesOverlap(slot.time, slot.timeEnd, lesson.timeStart, lesson.timeEnd || lesson.timeStart)) continue;
    return "в это время уже записан персональный урок";
  }

  return null;
}

export default function SchedulePanel({ toast }: SchedulePanelProps) {
  const scheduleQuery = useSchedule();
  const disciplinesQuery = useDisciplines();
  const locationsQuery = useLocations();
  const teamQuery = useTeamMembers();
  const personalLessonsQuery = usePersonalLessons();
  const { data: schedule = [], isLoading: scheduleLoading, isError: scheduleError, error: scheduleErr } = scheduleQuery;
  const { data: disciplines = [], isLoading: disciplinesLoading, isError: disciplinesError, error: disciplinesErr } = disciplinesQuery;
  const { data: locations = [], isLoading: locationsLoading, isError: locationsError, error: locationsErr } = locationsQuery;
  const { data: teamMembers = [], isLoading: teamLoading, isError: teamError, error: teamErr } = teamQuery;
  const { data: personalLessons = [], isLoading: personalLoading, isError: personalError, error: personalErr } = personalLessonsQuery;
  const addGroupSchedule = useAddGroupSchedule();
  const deleteSlot = useDeleteScheduleSlot();
  const replaceGroupSchedule = useReplaceGroupSchedule();
  const deleteGroupSchedule = useDeleteGroupSchedule();
  const { can, role: currentRole } = usePermissions();
  const canWriteSchedule = can("schedule.write");
  const canEditScheduleTeacher = currentRole === "owner" || currentRole === "director";

  const [groupName, setGroupName] = useState("");
  const [disciplineId, setDisciplineId] = useState<string | "">("");
  const [locationId, setLocationId] = useState<string | "">("");
  const [teacherMemberId, setTeacherMemberId] = useState<string | "">("");
  const [dayRows, setDayRows] = useState<DayFormRow[]>(() => [makeDayRow()]);
  const [deleteTarget, setDeleteTarget] = useState<ScheduleSlot | null>(null);
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<ScheduleGroup | null>(null);
  const [editingGroup, setEditingGroup] = useState<ScheduleGroup | null>(null);
  const [editSlots, setEditSlots] = useState<EditSlotRow[]>([]);
  const [originalSlotIds, setOriginalSlotIds] = useState<string[]>([]);
  const [editLocationId, setEditLocationId] = useState<string>("");
  const [editTeacherMemberId, setEditTeacherMemberId] = useState<string>("");

  useEffect(() => {
    if (disciplines.length > 0 && disciplineId === "") {
      setDisciplineId(disciplines[0].id);
    }
  }, [disciplines, disciplineId]);

  useEffect(() => {
    if (locations.length > 0 && locationId === "") {
      setLocationId(locations[0].id);
    }
  }, [locations, locationId]);

  const teacherOptions = useMemo(
    () =>
      teamMembers.filter(
        (member) =>
          member.is_active &&
          (member.role === "teacher" ||
            member.role === "owner" ||
            member.role === "director" ||
            member.role === "admin")
      ),
    [teamMembers]
  );

  useEffect(() => {
    if (teacherOptions.length > 0 && teacherMemberId === "") {
      setTeacherMemberId(teacherOptions[0].id);
    }
  }, [teacherOptions, teacherMemberId]);

  const locationMap = useMemo(
    () => Object.fromEntries(locations.map((loc) => [loc.id, loc])),
    [locations]
  );

  const teacherMap = useMemo(
    () => Object.fromEntries(teacherOptions.map((member) => [member.id, member])),
    [teacherOptions]
  );

  useEffect(() => {
    if (!editingGroup) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEditingGroup(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingGroup]);

  const disciplineMap = disciplines.reduce(
    (acc, d) => ({ ...acc, [d.id]: d }),
    {} as Record<number, (typeof disciplines)[0]>
  );

  const scheduleGroups = useMemo((): ScheduleGroup[] => {
    const groups = new Map<string, ScheduleSlot[]>();

    schedule.forEach((slot) => {
      const key = scheduleGroupKey(slot);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(slot);
    });

    return Array.from(groups.entries())
      .map(([groupKey, slots]) => {
        const first = slots[0];
        const disciplineId = first.disciplineId ?? null;
        const groupName = first.groupName ?? "";
        const slotLocationId = first.locationId ?? null;
        const slotTeacherId = first.teacherMemberId ?? null;
        const disciplineLabel =
          disciplineId != null
            ? disciplineMap[disciplineId]?.name || `Дисциплина #${disciplineId}`
            : "Без дисциплины";
        const displayName = groupName || disciplineLabel;
        const locationLabel = slotLocationId
          ? locationMap[slotLocationId]?.name ?? "Локация"
          : "Без локации";
        const teacherMember = slotTeacherId ? teacherMap[slotTeacherId] : undefined;
        const teacherLabel = teacherMember
          ? memberDisplayName(teacherMember) ?? memberRoleLabel(teacherMember.role, teacherMember.meta)
          : "Преподаватель не указан";

        return {
          groupKey,
          groupName,
          disciplineId,
          locationId: slotLocationId,
          teacherMemberId: slotTeacherId,
          displayName,
          disciplineLabel,
          locationLabel,
          teacherLabel,
          slots: slots.sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.time.localeCompare(b.time)),
        };
      })
      .sort((a, b) => a.locationLabel.localeCompare(b.locationLabel, "ru") || a.displayName.localeCompare(b.displayName, "ru"));
  }, [schedule, disciplineMap, locationMap, teacherMap]);

  const updateDayRow = (key: string, patch: Partial<DayFormRow>) => {
    setDayRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const handleAddDayRow = () => {
    setDayRows((prev) => [...prev, makeDayRow()]);
  };

  const handleRemoveDayRow = (key: string) => {
    setDayRows((prev) => (prev.length <= 1 ? prev : prev.filter((row) => row.key !== key)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedGroup = groupName.trim();
    if (!trimmedGroup) {
      toast("Укажите название группы.", "error");
      return;
    }
    if (!disciplineId) {
      toast("Выберите дисциплину.", "error");
      return;
    }
    if (!locationId) {
      toast("Выберите локацию.", "error");
      return;
    }
    if (!teacherMemberId) {
      toast("Выберите преподавателя.", "error");
      return;
    }

    for (const row of dayRows) {
      if (!row.time || !row.timeEnd) {
        toast("Заполните время для всех дней.", "error");
        return;
      }
      if (row.timeEnd <= row.time) {
        toast("Время окончания должно быть позже начала.", "error");
        return;
      }
    }

    const res = await addGroupSchedule.mutateAsync({
      groupName: trimmedGroup,
      disciplineId,
      locationId,
      teacherMemberId,
      days: dayRows.map(({ day, time, timeEnd }) => ({
        dayOfWeek: day,
        time,
        timeEnd,
      })),
    });

    if (!res.success) {
      toast(res.error || "Не удалось добавить занятия", "error");
    } else {
      toast(`Группа «${trimmedGroup}» добавлена в расписание`, "success");
      setGroupName("");
      setDayRows([makeDayRow()]);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || deleteTarget.id == null) return;

    const res = await deleteSlot.mutateAsync(deleteTarget.id);
    if (!res.success) {
      toast(res.error || "Не удалось удалить слот", "error");
    } else {
      toast("Класс убран из расписания", "success");
      setDeleteTarget(null);
    }
  };

  const startEditGroup = (group: ScheduleGroup) => {
    if (group.disciplineId == null) return;
    setEditingGroup(group);
    setEditLocationId(group.locationId ?? locations[0]?.id ?? "");
    setEditTeacherMemberId(group.teacherMemberId ?? teacherOptions[0]?.id ?? "");
    setOriginalSlotIds(group.slots.map((s) => s.id!).filter(Boolean));
    setEditSlots(
      group.slots.map((s) => ({
        key: String(s.id ?? `${s.dayOfWeek}-${s.time}`),
        id: s.id,
        dayOfWeek: s.dayOfWeek,
        time: s.time,
        timeEnd: s.timeEnd || "21:00",
      }))
    );
  };

  const handleConfirmGroupDelete = async () => {
    if (!deleteGroupTarget || deleteGroupTarget.disciplineId == null) return;

    const res = await deleteGroupSchedule.mutateAsync({
      groupName: deleteGroupTarget.groupName,
      disciplineId: deleteGroupTarget.disciplineId,
      locationId: deleteGroupTarget.locationId,
    });
    if (!res.success) {
      toast(res.error || "Не удалось удалить расписание группы", "error");
    } else {
      toast(`Расписание «${deleteGroupTarget.displayName}» удалено`, "success");
      setDeleteGroupTarget(null);
    }
  };

  const handleSaveGroupEdit = async () => {
    if (!editingGroup || editingGroup.disciplineId == null) return;

    if (!editLocationId) {
      toast("Выберите локацию.", "error");
      return;
    }
    if (canEditScheduleTeacher && !editTeacherMemberId) {
      toast("Выберите преподавателя.", "error");
      return;
    }

    for (const slot of editSlots) {
      if (!slot.time || !slot.timeEnd) {
        toast("Заполните время для всех занятий.", "error");
        return;
      }
      if (slot.timeEnd <= slot.time) {
        toast("Время окончания должно быть позже начала.", "error");
        return;
      }
    }

    const editIds = new Set(editSlots.map((s) => s.id));
    const resolvedLocationId = editLocationId || null;
    for (const slot of editSlots) {
      const conflict = getSlotConflict(
        slot,
        editingGroup.disciplineId,
        resolvedLocationId,
        schedule,
        personalLessons,
        editIds
      );
      if (conflict) {
        toast(`Конфликт: ${dowFull(slot.dayOfWeek)} ${slot.time} — ${conflict}`, "error");
        return;
      }
    }

    const removedIds = originalSlotIds.filter((id) => !editSlots.some((s) => s.id === id));

    const res = await replaceGroupSchedule.mutateAsync({
      groupName: editingGroup.groupName,
      disciplineId: editingGroup.disciplineId,
      locationId: resolvedLocationId,
      teacherMemberId: canEditScheduleTeacher
        ? editTeacherMemberId || null
        : editingGroup.teacherMemberId,
      slots: editSlots.map(({ dayOfWeek, time: t, timeEnd: te, id }) => ({
        id,
        dayOfWeek,
        time: t,
        timeEnd: te,
      })),
      removedIds,
    });

    if (!res.success) {
      toast(res.error || "Не удалось сохранить расписание", "error");
    } else {
      toast("Расписание обновлено", "success");
      setEditingGroup(null);
    }
  };

  const updateEditSlot = (key: string, patch: Partial<EditSlotRow>) => {
    setEditSlots((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  };

  if (scheduleLoading || disciplinesLoading || personalLoading || locationsLoading || teamLoading) {
    return <LoadingState label="Загрузка расписания..." />;
  }

  const isError = scheduleError || disciplinesError || personalError || locationsError || teamError;
  const error = scheduleErr ?? disciplinesErr ?? personalErr ?? locationsErr ?? teamErr;
  if (isError) return <QueryErrorState error={error} />;

  const editSlotIdSet = new Set(editSlots.map((s) => s.id));

  return (
    <div id="panel-schedule" className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
      <RequirePermission
        action="schedule.write"
        fallback={
          <div className="lg:col-span-4 bg-white rounded-xl p-4 border border-slate-200 shadow-xs text-xs text-slate-500">
            Изменение расписания недоступно для вашей роли или организация в режиме только чтения.
          </div>
        }
      >
        <div className="lg:col-span-4 bg-white rounded-xl p-4 border border-slate-200 shadow-xs panel-card-stack">
          <div className="flex items-center gap-2.5 text-slate-800 border-b border-slate-100 pb-3">
            <CalendarDays className="w-4.5 h-4.5 text-indigo-500" />
            <h2 className="text-base font-semibold tracking-tight">Внести новое занятие</h2>
          </div>

          <form onSubmit={handleSubmit} className="panel-form-stack">
            <div className="field-stack">
              <label className={labelCls}>Название группы</label>
              <input
                type="text"
                required
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Например, Старшая группа"
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
              label="Локация"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            >
              {locations.length === 0 ? (
                <option value="">Нет локаций</option>
              ) : (
                locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))
              )}
            </AppSelect>

            <AppSelect
              label="Преподаватель"
              value={teacherMemberId}
              onChange={(e) => setTeacherMemberId(e.target.value)}
            >
              {teacherOptions.length === 0 ? (
                <option value="">Нет преподавателей</option>
              ) : (
                teacherOptions.map((member) => (
                  <option key={member.id} value={member.id}>
                    {memberDisplayName(member) ?? memberRoleLabel(member.role, member.meta)}
                  </option>
                ))
              )}
            </AppSelect>

            {dayRows.map((row) => (
              <div key={row.key} className="space-y-3 pt-1 border-t border-slate-100 first:border-t-0 first:pt-0">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <AppSelect
                      label="День недели"
                      value={row.day}
                      onChange={(e) => updateDayRow(row.key, { day: parseInt(e.target.value, 10) })}
                    >
                      {dowFullEntries().map(([val, name]) => (
                        <option key={val} value={val}>
                          {name}
                        </option>
                      ))}
                    </AppSelect>
                  </div>
                  {dayRows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveDayRow(row.key)}
                      aria-label="Убрать день"
                      className="mt-6 p-2 rounded-lg border border-slate-200 text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="field-stack">
                    <label className={labelCls}>Время начала</label>
                    <div className="relative font-sans">
                      <Clock className="w-4 h-4 text-slate-300 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="time"
                        required
                        value={row.time}
                        onChange={(e) => updateDayRow(row.key, { time: e.target.value })}
                        className={`${fieldCls} pl-9`}
                      />
                    </div>
                  </div>
                  <div className="field-stack">
                    <label className={labelCls}>Время окончания</label>
                    <div className="relative font-sans">
                      <Clock className="w-4 h-4 text-slate-300 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="time"
                        required
                        value={row.timeEnd}
                        onChange={(e) => updateDayRow(row.key, { timeEnd: e.target.value })}
                        className={`${fieldCls} pl-9`}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))}

            <button type="button" onClick={handleAddDayRow} className={addDayBtnCls}>
              ＋ Добавить день
            </button>

            <button
              type="submit"
              disabled={addGroupSchedule.isPending}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-sans text-xs font-semibold tracking-widest uppercase rounded-lg transition-colors shadow-xs cursor-pointer disabled:opacity-60"
            >
              {addGroupSchedule.isPending ? "Добавление..." : "Вписать в сетку"}
            </button>
          </form>
        </div>
      </RequirePermission>

      <div className="lg:col-span-8 bg-white rounded-xl p-4 border border-slate-200 shadow-xs panel-card-stack">
        <div className="border-b border-slate-100 pb-3 space-y-1">
          <div className="flex items-center gap-2.5 text-slate-800">
            <CalendarRange className="w-4.5 h-4.5 text-indigo-500" />
            <h2 className="text-base font-semibold tracking-tight">Утверждённая сетка расписания</h2>
          </div>
          <p className="text-slate-400 text-xs font-sans pl-7">Групповые уроки</p>
        </div>

        {scheduleGroups.length === 0 ? (
          <div className="text-center py-20 text-slate-400 space-y-3">
            <CalendarDays className="w-8 h-8 mx-auto text-slate-300" />
            <p className="text-sm">
              Расписание пока пустое. Заполните форму слева, чтобы клиенты появились в журнале посещений.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {scheduleGroups.map((group) => (
              <div
                key={group.groupKey}
                className="bg-slate-50 rounded-xl border border-slate-100 p-4 space-y-2"
              >
                <div className="flex items-start justify-between gap-3 pb-2 border-b border-slate-200/60">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm tracking-tight text-slate-800 break-words">
                      {group.displayName}
                    </p>
                    {group.groupName && (
                      <p className="text-[10px] text-slate-400 font-sans mt-0.5">{group.disciplineLabel}</p>
                    )}
                    <p className="text-[10px] text-slate-400 font-sans mt-0.5">
                      {group.locationLabel} · {group.teacherLabel}
                    </p>
                  </div>
                  {group.disciplineId != null && canWriteSchedule && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => startEditGroup(group)}
                        className={iconBtnCls}
                        title="Редактировать"
                        aria-label={`Редактировать расписание ${group.displayName}`}
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteGroupTarget(group)}
                        className={deleteBtnCls}
                        title="Удалить"
                        aria-label={`Удалить расписание ${group.displayName}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  {group.slots.map((slot) => (
                    <div
                      key={slot.id ?? `${slot.dayOfWeek}-${slot.time}`}
                      className="flex items-center gap-2.5 py-1.5 px-2.5 bg-white border border-slate-200/60 rounded-lg text-sm"
                    >
                      <span className="w-2 h-2 rounded-full bg-indigo-500 shrink-0" />
                      <span className="font-semibold text-sm tracking-tight text-slate-800 shrink-0">
                        {dowFull(slot.dayOfWeek)}
                      </span>
                      <span className="inline-flex items-center gap-1.5 font-sans text-slate-700 font-semibold min-w-0">
                        <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        {slot.time} – {slot.timeEnd || "21:00"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {editingGroup && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setEditingGroup(null)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
            />
            <motion.div
              initial={{ scale: 0.97, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.97, opacity: 0, y: 8 }}
              transition={{ duration: 0.18 }}
              className="relative bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden max-w-md w-full p-4 panel-card-stack max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="min-w-0 pr-2">
                  <h3 className="text-base font-semibold tracking-tight text-slate-900 break-words">
                    {editingGroup.displayName}
                  </h3>
                  {editingGroup.groupName && (
                    <p className="text-[10px] text-slate-400 font-sans mt-0.5">{editingGroup.disciplineLabel}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setEditingGroup(null)}
                  aria-label="Закрыть"
                  className="p-1 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 cursor-pointer transition-colors shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="panel-form-stack font-sans">
                <AppSelect
                  label="Локация"
                  value={editLocationId}
                  onChange={(e) => setEditLocationId(e.target.value)}
                >
                  {locations.length === 0 ? (
                    <option value="">Нет локаций</option>
                  ) : (
                    locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                      </option>
                    ))
                  )}
                </AppSelect>

                {canEditScheduleTeacher ? (
                  <AppSelect
                    label="Преподаватель"
                    value={editTeacherMemberId}
                    onChange={(e) => setEditTeacherMemberId(e.target.value)}
                  >
                    {teacherOptions.length === 0 ? (
                      <option value="">Нет преподавателей</option>
                    ) : (
                      teacherOptions.map((member) => (
                        <option key={member.id} value={member.id}>
                          {memberDisplayName(member) ?? memberRoleLabel(member.role, member.meta)}
                        </option>
                      ))
                    )}
                  </AppSelect>
                ) : (
                  <div className="field-stack">
                    <span className={labelCls}>Преподаватель</span>
                    <p className="text-sm text-slate-700 px-3 py-2 bg-slate-50 border border-slate-100 rounded-lg">
                      {editingGroup.teacherLabel}
                    </p>
                  </div>
                )}

                {editSlots.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-4">Нет занятий для редактирования.</p>
                ) : (
                  editSlots.map((slot) => {
                    const conflict =
                      editingGroup.disciplineId != null &&
                      getSlotConflict(
                        slot,
                        editingGroup.disciplineId,
                        editLocationId || null,
                        schedule,
                        personalLessons,
                        editSlotIdSet
                      );

                    return (
                      <div key={slot.key} className="p-3 bg-slate-50 rounded-lg border border-slate-100 space-y-2">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <AppSelect
                            value={slot.dayOfWeek}
                            onChange={(e) =>
                              updateEditSlot(slot.key, { dayOfWeek: parseInt(e.target.value, 10) })
                            }
                            className="text-xs py-2"
                          >
                            {dowFullEntries().map(([val, name]) => (
                              <option key={val} value={val}>
                                {name}
                              </option>
                            ))}
                          </AppSelect>
                          <input
                            type="time"
                            value={slot.time}
                            onChange={(e) => updateEditSlot(slot.key, { time: e.target.value })}
                            className={fieldCls}
                          />
                          <input
                            type="time"
                            value={slot.timeEnd}
                            onChange={(e) => updateEditSlot(slot.key, { timeEnd: e.target.value })}
                            className={fieldCls}
                          />
                        </div>
                        {conflict && <p className="text-[10px] text-rose-600 font-sans">{conflict}</p>}
                      </div>
                    );
                  })
                )}
              </div>

              <div className="flex items-center gap-3 pt-1 text-xs">
                <button
                  type="button"
                  onClick={handleSaveGroupEdit}
                  disabled={replaceGroupSchedule.isPending || editSlots.length === 0}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold uppercase tracking-wider font-sans rounded-lg transition-colors cursor-pointer disabled:opacity-60"
                >
                  {replaceGroupSchedule.isPending ? "..." : "Подтвердить"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingGroup(null)}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold uppercase tracking-wider font-sans rounded-lg transition-colors cursor-pointer"
                >
                  Отмена
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Удалить класс из расписания?"
        description={
          deleteTarget ? (
            <>
              Групповой класс{" "}
              <strong className="font-semibold text-slate-800">
                {dowFull(deleteTarget.dayOfWeek)} {deleteTarget.time} – {deleteTarget.timeEnd || "21:00"}
              </strong>{" "}
              будет убран из сетки. Будущие занятия по этому слоту исчезнут из журнала.
            </>
          ) : (
            ""
          )
        }
        confirmLabel="Удалить"
        pending={deleteSlot.isPending}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={deleteGroupTarget !== null}
        title="Удалить расписание группы?"
        description={
          deleteGroupTarget ? (
            <>
              Все групповые занятия{" "}
              <strong className="font-semibold text-slate-800">{deleteGroupTarget.displayName}</strong> будут убраны
              из сетки.
            </>
          ) : (
            ""
          )
        }
        confirmLabel="Удалить"
        pending={deleteGroupSchedule.isPending}
        onConfirm={handleConfirmGroupDelete}
        onCancel={() => setDeleteGroupTarget(null)}
      />
    </div>
  );
}
