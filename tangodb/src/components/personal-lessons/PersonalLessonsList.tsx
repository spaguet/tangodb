import { Sparkles } from "lucide-react";
import { useMemo } from "react";
import { PERSONAL_LESSON_COLOR } from "../../lib/scheduleColors";
import { toISODateLocal } from "../../lib/scheduleWeek";
import type { PersonalLesson } from "../../types";
import type { MemberRole } from "../../types/organization";
import type { PermissionAction } from "../../lib/permissions";
import { useI18n } from "../../hooks/useI18n";
import PersonalLessonRow from "./PersonalLessonRow";

type CanFn = (action: PermissionAction, context?: { disciplineId?: string | null; locationId?: string | null }) => boolean;

interface PersonalLessonsListProps {
  lessons: PersonalLesson[];
  role: MemberRole | null;
  memberId: string | null;
  isReadOnly: boolean;
  canEditPastSchedule?: boolean;
  can: CanFn;
  showPrice: boolean;
  locationMap: Map<string, string>;
  disciplineMap: Map<string, string>;
  teacherMap: Map<string, string>;
  onEdit: (lesson: PersonalLesson) => void;
  onDelete: (lesson: PersonalLesson) => void;
  onPay: (lesson: PersonalLesson) => void;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
}

export default function PersonalLessonsList({
  lessons,
  role,
  memberId,
  isReadOnly,
  canEditPastSchedule = false,
  can,
  showPrice,
  locationMap,
  disciplineMap,
  teacherMap,
  onEdit,
  onDelete,
  onPay,
  toast,
}: PersonalLessonsListProps) {
  const { t, plural, formatDate } = useI18n();
  const todayISO = toISODateLocal(new Date());

  const groupedByDate = useMemo(() => {
    const groups = new Map<string, PersonalLesson[]>();
    for (const lesson of lessons) {
      const bucket = groups.get(lesson.date) ?? [];
      bucket.push(lesson);
      groups.set(lesson.date, bucket);
    }

    for (const dateLessons of groups.values()) {
      dateLessons.sort((a, b) => b.timeStart.localeCompare(a.timeStart));
    }

    return [...groups.entries()]
      .sort(([dateA], [dateB]) => dateB.localeCompare(dateA))
      .map(([date, dateLessons]) => [date, dateLessons] as const);
  }, [lessons]);

  if (lessons.length === 0) {
    return (
      <div className="text-center py-20 text-slate-400 space-y-3 bg-white rounded-xl border border-slate-200">
        <Sparkles className="w-8 h-8 mx-auto text-slate-300" />
        <p className="text-sm">{t("personal.empty.filtered")}</p>
      </div>
    );
  }

  return (
    <div className="panel-card-stack">
      {groupedByDate.map(([date, dateLessons]) => {
        const isCurrentOrFuture = date >= todayISO;
        return (
          <div
            key={date}
            className={`bg-white rounded-xl shadow-xs overflow-hidden ${
              isCurrentOrFuture
                ? `border-2 ${PERSONAL_LESSON_COLOR.border}`
                : "border border-slate-200"
            }`}
          >
            <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50/60 flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-800">{formatDate(date)}</span>
              <span className="text-xs text-slate-400">·</span>
              <span className="text-xs font-semibold text-indigo-700">
                {dateLessons.length}{" "}
                {plural(dateLessons.length, [
                  t("common.lesson.one"),
                  t("common.lesson.few"),
                  t("common.lesson.many"),
                ])}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-left">
                <thead>
                  <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                    <th className="py-2 px-3">{t("common.time")}</th>
                    <th className="py-2 px-3">{t("schedule.form.location")}</th>
                    <th className="py-2 px-3">{t("common.discipline")}</th>
                    <th className="py-2 px-3">{t("schedule.form.teacher")}</th>
                    <th className="py-2 px-3">{t("common.clients")}</th>
                    <th className="py-2 px-3">{t("common.format")}</th>
                    <th className="py-2 px-3">{t("common.statuses")}</th>
                    <th className="py-2 px-3">{t("common.amount")}</th>
                    <th className="py-2 px-3">{t("common.attendance")}</th>
                    <th className="py-2 px-3">{t("common.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {dateLessons.map((lesson) => (
                    <PersonalLessonRow
                      key={lesson.id}
                      lesson={lesson}
                      role={role}
                      memberId={memberId}
                      isReadOnly={isReadOnly}
                      canEditPastSchedule={canEditPastSchedule}
                      can={can}
                      showPrice={showPrice}
                      locationName={
                        lesson.locationId ? locationMap.get(lesson.locationId) : undefined
                      }
                      disciplineName={
                        lesson.disciplineId ? disciplineMap.get(lesson.disciplineId) : undefined
                      }
                      teacherName={
                        lesson.teacherMemberId ? teacherMap.get(lesson.teacherMemberId) : undefined
                      }
                      onEdit={onEdit}
                      onDelete={onDelete}
                      onPay={onPay}
                      toast={toast}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
