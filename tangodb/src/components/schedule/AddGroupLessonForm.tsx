import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { MapPin, Trash2, X } from "lucide-react";
import { useAddGroupSchedule } from "../../hooks/useSchedule";
import { memberDisplayName, memberListLabel, type TeamMemberRow } from "../../hooks/useTeamMembers";
import { findScheduleConflict } from "../../lib/scheduleConflicts";
import { computeAutoTimeEnd, validateTimeRange } from "../../lib/scheduleTime";
import { nextOccurrenceOnOrAfter, toISODateLocal } from "../../lib/scheduleWeek";
import { dowFullEntries, timesOverlap } from "../../lib/utils";
import type { Discipline } from "../../types";
import AppSelect from "../ui/AppSelect";
import DisciplineSelect from "../ui/DisciplineSelect";
import TimeSelect from "../ui/TimeSelect";
import type { ScheduleCellPrefill } from "./AddLessonTypePopup";

interface AddGroupLessonFormProps {
  prefill: ScheduleCellPrefill | null;
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
const addDayBtnCls =
  "w-full py-2 bg-slate-50 border border-dashed border-slate-300 hover:border-slate-400 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors font-sans text-xs font-semibold uppercase tracking-wider cursor-pointer";

interface GroupSlotRow {
  key: string;
  dayOfWeek: number;
  timeStart: string;
  timeEnd: string;
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

export default function AddGroupLessonForm({
  prefill,
  disciplines,
  teacherOptions,
  scheduleSlots,
  personalLessons,
  toast,
  onClose,
  onSuccess,
}: AddGroupLessonFormProps) {
  const addGroupSchedule = useAddGroupSchedule();

  const [groupName, setGroupName] = useState("");
  const [disciplineId, setDisciplineId] = useState<string>("");
  const [teacherMemberId, setTeacherMemberId] = useState("");
  const [groupSlotRows, setGroupSlotRows] = useState<GroupSlotRow[]>([]);

  useEffect(() => {
    if (!prefill) return;
    setGroupName("");
    setGroupSlotRows([
      makeGroupSlotRow(prefill.dayOfWeek, prefill.timeStart, computeAutoTimeEnd(prefill.timeStart, [])),
    ]);
    if (disciplines.length > 0) setDisciplineId(disciplines[0].id);
    if (teacherOptions.length > 0) setTeacherMemberId(teacherOptions[0].id);
  }, [prefill, disciplines, teacherOptions]);

  useEffect(() => {
    if (!prefill) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prefill, onClose]);

  const updateGroupSlotRow = (key: string, patch: Partial<GroupSlotRow>) => {
    setGroupSlotRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const getSameDayLessons = (dayOfWeek: number) => {
    if (!prefill) return [];
    const date = nextOccurrenceOnOrAfter(toISODateLocal(new Date()), dayOfWeek);
    return [
      ...scheduleSlots
        .filter((s) => s.dayOfWeek === dayOfWeek && s.locationId === prefill.locationId)
        .map((s) => ({ timeStart: s.time, timeEnd: s.timeEnd })),
      ...personalLessons
        .filter((l) => l.date === date && l.locationId === prefill.locationId)
        .map((l) => ({ timeStart: l.timeStart, timeEnd: l.timeEnd })),
    ];
  };

  const handleGroupSlotTimeStartChange = (key: string, next: string) => {
    setGroupSlotRows((prev) =>
      prev.map((row) => {
        if (row.key !== key) return row;
        return { ...row, timeStart: next, timeEnd: computeAutoTimeEnd(next, getSameDayLessons(row.dayOfWeek)) };
      })
    );
  };

  const handleAddGroupDay = () => {
    setGroupSlotRows((prev) => {
      const lastRow = prev.at(-1);
      const dayOfWeek = ((lastRow?.dayOfWeek ?? prefill?.dayOfWeek ?? 1) % 7) + 1;
      const timeStart = lastRow?.timeStart ?? prefill?.timeStart ?? "19:00";
      return [...prev, makeGroupSlotRow(dayOfWeek, timeStart, computeAutoTimeEnd(timeStart, getSameDayLessons(dayOfWeek)))];
    });
  };

  const handleRemoveGroupDay = (key: string) => {
    setGroupSlotRows((prev) => (prev.length <= 1 ? prev : prev.filter((row) => row.key !== key)));
  };

  const groupSlotConflicts = useMemo(() => {
    if (!prefill) return new Map<string, string>();

    const conflicts = new Map<string, string>();
    const today = toISODateLocal(new Date());
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

      const conflictDate = nextOccurrenceOnOrAfter(today, row.dayOfWeek);
      const external = findScheduleConflict(
        {
          date: conflictDate,
          timeStart: row.timeStart,
          timeEnd: row.timeEnd,
          locationId: prefill.locationId,
        },
        personalLessons,
        scheduleSlots
      );
      if (external) {
        conflicts.set(row.key, external);
      }
    }

    return conflicts;
  }, [prefill, groupSlotRows, personalLessons, scheduleSlots]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prefill) return;

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
    if (groupSlotRows.length === 0) {
      toast("Добавьте хотя бы один день и время.", "error");
      return;
    }
    if (groupSlotConflicts.size > 0) {
      toast("Исправьте конфликты в расписании перед добавлением.", "error");
      return;
    }

    const res = await addGroupSchedule.mutateAsync({
      groupName: trimmedGroup,
      disciplineId,
      locationId: prefill.locationId,
      teacherMemberId,
      days: groupSlotRows.map((row) => ({
        dayOfWeek: row.dayOfWeek,
        time: row.timeStart,
        timeEnd: row.timeEnd,
      })),
    });

    if (!res.success) {
      toast(res.error ?? "Не удалось добавить занятие", "error");
      return;
    }

    toast(`Группа «${trimmedGroup}» добавлена в расписание`, "success");
    onSuccess();
    onClose();
  };

  return (
    <AnimatePresence>
      {prefill && (
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
                  Групповой урок
                </p>
                <h3 className="text-base font-semibold tracking-tight text-slate-900">Новое занятие</h3>
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

            <form onSubmit={handleSubmit} className="panel-form-stack">
              <div className="field-stack">
                <label className={labelCls}>Локация</label>
                <div className="flex items-center gap-2 px-3.5 py-2.5 bg-slate-100 border border-slate-200 rounded-lg text-sm text-slate-700">
                  <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
                  {prefill.locationName}
                </div>
              </div>

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
                      <div key={row.key} className="p-3 bg-slate-50 rounded-lg border border-slate-100 space-y-2">
                        <div className="flex items-start gap-2">
                          <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <AppSelect
                              value={row.dayOfWeek}
                              onChange={(e) => {
                                const dayOfWeek = parseInt(e.target.value, 10);
                                updateGroupSlotRow(row.key, {
                                  dayOfWeek,
                                  timeEnd: computeAutoTimeEnd(row.timeStart, getSameDayLessons(dayOfWeek)),
                                });
                              }}
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
                        {conflict && <p className="text-[10px] text-rose-600 font-sans">Конфликт: {conflict}</p>}
                      </div>
                    );
                  })}
                </div>
                <button type="button" onClick={handleAddGroupDay} className={addDayBtnCls}>
                  + Добавить день и время
                </button>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="submit"
                  disabled={addGroupSchedule.isPending || groupSlotConflicts.size > 0}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold uppercase tracking-wider rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                >
                  Добавить
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold uppercase tracking-wider rounded-lg transition-colors cursor-pointer"
                >
                  Отмена
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
