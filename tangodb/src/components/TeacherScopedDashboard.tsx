import { useMemo } from "react";
import { CalendarDays, ClipboardCheck, Clock, Sparkles, Wallet } from "lucide-react";
import { useI18n } from "../hooks/useI18n";
import { usePermissions } from "../hooks/usePermissions";
import { useOrganization } from "../organization/OrganizationProvider";
import { usePersonalLessonsModuleEnabled } from "../hooks/useOrgModules";
import { normalizeOrgModules } from "../lib/orgModules";
import { expandSlotsToDateRange } from "../lib/scheduleWeek";
import { isLessonInTeacherScope, maskClientDisplay } from "../lib/scheduleLessonAccess";
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
  const { can, role, scope, membership } = usePermissions();
  const { settings } = useOrganization();
  const modules = normalizeOrgModules(settings?.modules);
  const personalLessonsEnabled = usePersonalLessonsModuleEnabled();
  const showPayrollLink =
    modules.finance_basic && can("payroll.read.own") && !can("finance.read");
  const memberId = membership?.id ?? null;
  const canReadClients = can("clients.read");

  const quickLinks = [
    ...QUICK_LINKS.filter((link) => link.id !== "personalView" || personalLessonsEnabled),
    ...(showPayrollLink
      ? [{ id: "payroll" as const, labelKey: "dashboard.teacher.quickPayroll" as const, icon: Wallet }]
      : []),
  ];
  const todayDate = localIsoDate();
  const todayGroupLessons = useMemo(() => {
    const lessons = expandSlotsToDateRange(scheduleSlots, todayDate, todayDate);
    const scoped =
      role === "teacher"
        ? lessons.filter((lesson) => isLessonInTeacherScope(role, memberId, lesson, scope))
        : lessons;
    return scoped.sort((a, b) => a.timeStart.localeCompare(b.timeStart));
  }, [scheduleSlots, todayDate, role, memberId, scope]);
  const upcomingLessons = useMemo(() => {
    const scoped =
      role === "teacher" && memberId
        ? personalLessons.filter(
            (lesson) =>
              lesson.teacherMemberId === memberId ||
              lesson.substituteTeacherMemberId === memberId
          )
        : personalLessons;
    return pickUpcomingLessons(scoped, todayDate, 5);
  }, [personalLessons, todayDate, role, memberId]);

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
        {todayGroupLessons.length === 0 ? (
          <p className="text-slate-400 text-xs font-sans py-3 text-center">{t("dashboard.teacher.noClassesToday")}</p>
        ) : (
          <ul className="space-y-1.5">
            {todayGroupLessons.map((lesson) => (
              <li
                key={`${lesson.slotId}-${lesson.date}`}
                className="flex items-center justify-between p-2 bg-slate-50 rounded-lg border border-slate-100 text-xs font-sans"
              >
                <span className="font-semibold text-slate-800">
                  {lesson.groupName || t("common.group")}
                  {lesson.disciplineId && disciplineNames[lesson.disciplineId]
                    ? ` · ${disciplineNames[lesson.disciplineId]}`
                    : ""}
                </span>
                <span className="text-slate-500 flex items-center gap-1 shrink-0">
                  <Clock className="w-3.5 h-3.5" />
                  {lesson.timeStart}–{lesson.timeEnd}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {personalLessonsEnabled ? (
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
                  <span className="font-semibold text-slate-800 truncate">
                    {maskClientDisplay(lesson.clientDisplay, canReadClients)}
                  </span>
                  <span className="text-slate-500 shrink-0 ml-2">
                    {formatDate(lesson.date, { day: "numeric", month: "long", year: "numeric" })} · {lesson.timeStart}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
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
