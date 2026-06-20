import { CalendarDays, ClipboardCheck, Clock, Sparkles } from "lucide-react";
import { formatDateRu, jsDayToIsoDow } from "../lib/utils";
import type { PersonalLesson, ScheduleSlot } from "../types";

interface TeacherScopedDashboardProps {
  personalLessons: PersonalLesson[];
  scheduleSlots: ScheduleSlot[];
  disciplineNames: Record<string, string>;
  onNavigate: (panel: string) => void;
}

const QUICK_LINKS = [
  { id: "attendance", label: "Журнал посещений", icon: ClipboardCheck },
  { id: "schedule", label: "Расписание", icon: CalendarDays },
  { id: "personalView", label: "Персональные уроки", icon: Sparkles },
] as const;

export default function TeacherScopedDashboard({
  personalLessons,
  scheduleSlots,
  disciplineNames,
  onNavigate,
}: TeacherScopedDashboardProps) {
  const todayIso = jsDayToIsoDow(new Date().getDay());
  const todayDate = localIsoDate();
  const todaySlots = scheduleSlots
    .filter((slot) => slot.dayOfWeek === todayIso)
    .sort((a, b) => a.time.localeCompare(b.time));
  const upcomingLessons = pickUpcomingLessons(personalLessons, todayDate, 5);

  return (
    <div id="panel-dashboard" className="panel-page-stack">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {QUICK_LINKS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onNavigate(id)}
            className="bg-white rounded-xl px-4 py-3 border border-slate-200/90 shadow-xs hover:shadow-sm transition-all text-left flex items-center gap-3"
          >
            <Icon className="w-5 h-5 text-indigo-600 shrink-0" />
            <span className="text-sm font-semibold text-slate-800">{label}</span>
          </button>
        ))}
      </div>

      <section className="bg-white rounded-xl p-3.5 border border-slate-200/90 shadow-xs space-y-2">
        <h2 className="font-sans text-sm font-semibold text-slate-800 flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-indigo-500" />
          Сегодня в расписании
        </h2>
        {todaySlots.length === 0 ? (
          <p className="text-slate-400 text-xs font-sans py-3 text-center">Занятий на сегодня нет</p>
        ) : (
          <ul className="space-y-1.5">
            {todaySlots.map((slot) => (
              <li
                key={slot.id ?? `${slot.dayOfWeek}-${slot.time}`}
                className="flex items-center justify-between p-2 bg-slate-50 rounded-lg border border-slate-100 text-xs font-sans"
              >
                <span className="font-semibold text-slate-800">
                  {slot.groupName || "Группа"}
                  {slot.disciplineId && disciplineNames[slot.disciplineId]
                    ? ` · ${disciplineNames[slot.disciplineId]}`
                    : ""}
                </span>
                <span className="text-slate-500 flex items-center gap-1 shrink-0">
                  <Clock className="w-3.5 h-3.5" />
                  {slot.time}–{slot.timeEnd}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-white rounded-xl p-3.5 border border-slate-200/90 shadow-xs space-y-2">
        <h2 className="font-sans text-sm font-semibold text-slate-800 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-indigo-500" />
          Ближайшие персональные уроки
        </h2>
        {upcomingLessons.length === 0 ? (
          <p className="text-slate-400 text-xs font-sans py-3 text-center">Нет запланированных уроков</p>
        ) : (
          <ul className="space-y-1.5">
            {upcomingLessons.map((lesson) => (
              <li
                key={lesson.id}
                className="flex items-center justify-between p-2 bg-slate-50 rounded-lg border border-slate-100 text-xs font-sans"
              >
                <span className="font-semibold text-slate-800 truncate">{lesson.clientDisplay}</span>
                <span className="text-slate-500 shrink-0 ml-2">
                  {formatDateRu(lesson.date)} · {lesson.timeStart}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function localIsoDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function pickUpcomingLessons(
  lessons: PersonalLesson[],
  fromDate: string,
  limit: number
): PersonalLesson[] {
  return lessons
    .filter((lesson) => lesson.date >= fromDate)
    .sort((a, b) => `${a.date}${a.timeStart}`.localeCompare(`${b.date}${b.timeStart}`))
    .slice(0, limit);
}
