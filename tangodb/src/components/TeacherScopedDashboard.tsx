import { CalendarDays, ClipboardCheck, Clock, Sparkles, Wallet } from "lucide-react";
import { jsDayToIsoDow } from "../lib/utils";
import { useI18n } from "../hooks/useI18n";
import { usePermissions } from "../hooks/usePermissions";
import { useOrganization } from "../organization/OrganizationProvider";
import { normalizeOrgModules } from "../lib/orgModules";
import type { PersonalLesson, ScheduleSlot } from "../types";

interface TeacherScopedDashboardProps {
  personalLessons: PersonalLesson[];
  scheduleSlots: ScheduleSlot[];
  disciplineNames: Record<string, string>;
  onNavigate: (panel: string) => void;
}

const QUICK_LINKS = [
  { id: "attendance", labelKey: "dashboard.teacher.quickAttendance" as const, icon: ClipboardCheck },
  { id: "schedule", labelKey: "dashboard.teacher.quickSchedule" as const, icon: CalendarDays },
  { id: "personalView", labelKey: "dashboard.teacher.quickPersonal" as const, icon: Sparkles },
] as const;

export default function TeacherScopedDashboard({
  personalLessons,
  scheduleSlots,
  disciplineNames,
  onNavigate,
}: TeacherScopedDashboardProps) {
  const { t, formatDate } = useI18n();
  const { can } = usePermissions();
  const { settings } = useOrganization();
  const modules = normalizeOrgModules(settings?.modules);
  const showPayrollLink =
    modules.finance_basic && can("payroll.read.own") && !can("finance.read");

  const quickLinks = [
    ...QUICK_LINKS,
    ...(showPayrollLink
      ? [{ id: "payroll" as const, labelKey: "dashboard.teacher.quickPayroll" as const, icon: Wallet }]
      : []),
  ];
  const todayIso = jsDayToIsoDow(new Date().getDay());
  const todayDate = localIsoDate();
  const todaySlots = scheduleSlots
    .filter((slot) => slot.dayOfWeek === todayIso)
    .sort((a, b) => a.time.localeCompare(b.time));
  const upcomingLessons = pickUpcomingLessons(personalLessons, todayDate, 5);

  return (
    <div id="panel-dashboard" className="panel-page-stack">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {quickLinks.map(({ id, labelKey, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onNavigate(id)}
            className="bg-white rounded-xl px-4 py-3 border border-slate-200/90 shadow-xs hover:shadow-sm transition-all text-left flex items-center gap-3"
          >
            <Icon className="w-5 h-5 text-indigo-600 shrink-0" />
            <span className="text-sm font-semibold text-slate-800">{t(labelKey)}</span>
          </button>
        ))}
      </div>

      <section className="bg-white rounded-xl p-3.5 border border-slate-200/90 shadow-xs space-y-2">
        <h2 className="font-sans text-sm font-semibold text-slate-800 flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-indigo-500" />
          {t("dashboard.teacher.todaySchedule")}
        </h2>
        {todaySlots.length === 0 ? (
          <p className="text-slate-400 text-xs font-sans py-3 text-center">{t("dashboard.teacher.noClassesToday")}</p>
        ) : (
          <ul className="space-y-1.5">
            {todaySlots.map((slot) => (
              <li
                key={slot.id ?? `${slot.dayOfWeek}-${slot.time}`}
                className="flex items-center justify-between p-2 bg-slate-50 rounded-lg border border-slate-100 text-xs font-sans"
              >
                <span className="font-semibold text-slate-800">
                  {slot.groupName || t("common.group")}
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
          {t("dashboard.teacher.upcomingPersonal")}
        </h2>
        {upcomingLessons.length === 0 ? (
          <p className="text-slate-400 text-xs font-sans py-3 text-center">{t("dashboard.teacher.noUpcoming")}</p>
        ) : (
          <ul className="space-y-1.5">
            {upcomingLessons.map((lesson) => (
              <li
                key={lesson.id}
                className="flex items-center justify-between p-2 bg-slate-50 rounded-lg border border-slate-100 text-xs font-sans"
              >
                <span className="font-semibold text-slate-800 truncate">{lesson.clientDisplay}</span>
                <span className="text-slate-500 shrink-0 ml-2">
                  {formatDate(lesson.date, { day: "numeric", month: "long", year: "numeric" })} · {lesson.timeStart}
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
