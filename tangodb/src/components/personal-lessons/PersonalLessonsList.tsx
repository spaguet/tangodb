import { Sparkles } from "lucide-react";
import { useMemo } from "react";
import { formatDateRu, pluralizeRu } from "../../lib/utils";
import type { PersonalLesson } from "../../types";
import type { MemberRole } from "../../types/organization";
import type { PermissionAction } from "../../lib/permissions";
import PersonalLessonRow from "./PersonalLessonRow";

type CanFn = (action: PermissionAction, context?: { disciplineId?: string | null; locationId?: string | null }) => boolean;

interface PersonalLessonsListProps {
  lessons: PersonalLesson[];
  role: MemberRole | null;
  memberId: string | null;
  isReadOnly: boolean;
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
  const grouped = useMemo(() => {
    const sorted = [...lessons].sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.timeStart.localeCompare(b.timeStart)
    );
    const groups = new Map<string, PersonalLesson[]>();
    for (const lesson of sorted) {
      const bucket = groups.get(lesson.date) ?? [];
      bucket.push(lesson);
      groups.set(lesson.date, bucket);
    }
    return groups;
  }, [lessons]);

  if (lessons.length === 0) {
    return (
      <div className="text-center py-20 text-slate-400 space-y-3 bg-white rounded-xl border border-slate-200">
        <Sparkles className="w-8 h-8 mx-auto text-slate-300" />
        <p className="text-sm">Персональных уроков с такими критериями нет.</p>
      </div>
    );
  }

  return (
    <div className="panel-card-stack">
      {Array.from(grouped.entries()).map(([date, dateLessons]) => (
        <div key={date} className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50/60 flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-800">{formatDateRu(date)}</span>
            <span className="text-xs text-slate-400">·</span>
            <span className="text-xs font-semibold text-indigo-700">
              {dateLessons.length} {pluralizeRu(dateLessons.length, ["урок", "урока", "уроков"])}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left">
              <thead>
                <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                  <th className="py-2 px-3">Время</th>
                  <th className="py-2 px-3">Локация</th>
                  <th className="py-2 px-3">Направление</th>
                  <th className="py-2 px-3">Преподаватель</th>
                  <th className="py-2 px-3">Клиенты</th>
                  <th className="py-2 px-3">Формат</th>
                  <th className="py-2 px-3">Статусы</th>
                  <th className="py-2 px-3">Сумма</th>
                  <th className="py-2 px-3">Посещение</th>
                  <th className="py-2 px-3">Действия</th>
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
      ))}
    </div>
  );
}
