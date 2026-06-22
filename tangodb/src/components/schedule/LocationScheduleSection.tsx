import WeeklyScheduleGrid from "./WeeklyScheduleGrid";
import type { DisplayLesson } from "../../types";

interface LocationScheduleSectionProps {
  locationName: string;
  weekStart: Date;
  lessons: DisplayLesson[];
  getLessonTitle: (lesson: DisplayLesson) => string;
  getLessonSubtitle: (lesson: DisplayLesson) => string | undefined;
  onLessonClick?: (lesson: DisplayLesson) => void;
}

export default function LocationScheduleSection({
  locationName,
  weekStart,
  lessons,
  getLessonTitle,
  getLessonSubtitle,
  onLessonClick,
}: LocationScheduleSectionProps) {
  return (
    <section className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/60">
        <h3 className="text-sm font-semibold text-slate-800 tracking-tight">{locationName}</h3>
      </div>

      {lessons.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm">Нет занятий на этой неделе</div>
      ) : (
        <WeeklyScheduleGrid
          weekStart={weekStart}
          lessons={lessons}
          getLessonTitle={getLessonTitle}
          getLessonSubtitle={getLessonSubtitle}
          onLessonClick={onLessonClick}
        />
      )}
    </section>
  );
}
