import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarDays, MapPin, X } from "lucide-react";
import { useAddGroupSchedule } from "../../hooks/useSchedule";
import { memberDisplayName, memberListLabel, type TeamMemberRow } from "../../hooks/useTeamMembers";
import { findScheduleConflict } from "../../lib/scheduleConflicts";
import { computeAutoTimeEnd, validateTimeRange } from "../../lib/scheduleTime";
import { formatDateRu } from "../../lib/utils";
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
  const [timeStart, setTimeStart] = useState("19:00");
  const [timeEnd, setTimeEnd] = useState("20:00");

  useEffect(() => {
    if (!prefill) return;
    setGroupName("");
    setTimeStart(prefill.timeStart);
    setTimeEnd(computeAutoTimeEnd(prefill.timeStart, []));
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

  const sameDayLessons = useMemo(() => {
    if (!prefill) return [];
    return [
      ...scheduleSlots
        .filter((s) => s.dayOfWeek === prefill.dayOfWeek && s.locationId === prefill.locationId)
        .map((s) => ({ timeStart: s.time, timeEnd: s.timeEnd })),
      ...personalLessons
        .filter((l) => l.date === prefill.date && l.locationId === prefill.locationId)
        .map((l) => ({ timeStart: l.timeStart, timeEnd: l.timeEnd })),
    ];
  }, [prefill, scheduleSlots, personalLessons]);

  const handleTimeStartChange = (next: string) => {
    setTimeStart(next);
    setTimeEnd(computeAutoTimeEnd(next, sameDayLessons));
  };

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

    const rangeError = validateTimeRange(timeStart, timeEnd);
    if (rangeError) {
      toast(rangeError, "error");
      return;
    }

    const conflict = findScheduleConflict(
      {
        date: prefill.date,
        timeStart,
        timeEnd,
        locationId: prefill.locationId,
      },
      personalLessons,
      scheduleSlots
    );
    if (conflict) {
      toast(`Конфликт: ${formatDateRu(prefill.date)} ${timeStart} — ${conflict}`, "error");
      return;
    }

    const res = await addGroupSchedule.mutateAsync({
      groupName: trimmedGroup,
      disciplineId,
      locationId: prefill.locationId,
      teacherMemberId,
      days: [{ dayOfWeek: prefill.dayOfWeek, time: timeStart, timeEnd }],
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
                <label className={labelCls}>День</label>
                <div className="flex items-center gap-2 px-3.5 py-2.5 bg-slate-100 border border-slate-200 rounded-lg text-sm text-slate-700">
                  <CalendarDays className="w-4 h-4 text-slate-400 shrink-0" />
                  {formatDateRu(prefill.date)}
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

              <div className="grid grid-cols-2 gap-3">
                <TimeSelect label="Начало" value={timeStart} onChange={handleTimeStartChange} required />
                <TimeSelect label="Окончание" value={timeEnd} onChange={setTimeEnd} required />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="submit"
                  disabled={addGroupSchedule.isPending}
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
