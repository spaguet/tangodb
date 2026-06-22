import WeeklyScheduleGrid from "./WeeklyScheduleGrid";
import type { DisplayLesson } from "../../types";

interface LocationScheduleSectionProps {
  locationName: string;
  locationId?: string | null;
  weekStart: Date;
  lessons: DisplayLesson[];
  getLessonTitle: (lesson: DisplayLesson) => string;
  getLessonSubtitle: (lesson: DisplayLesson) => string | undefined;
  onLessonClick?: (lesson: DisplayLesson) => void;
  onEmptyCellClick?: (dateISO: string, dayOfWeek: number, timeStart: string) => void;
  canClickEmpty?: boolean;
}

export default function LocationScheduleSection({
  locationName,
  locationId,
  weekStart,
  lessons,
  getLessonTitle,
  getLessonSubtitle,
  onLessonClick,
  onEmptyCellClick,
  canClickEmpty = false,
}: LocationScheduleSectionProps) {
  const showGrid = lessons.length > 0 || (canClickEmpty && locationId);

  return (
    <section className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/60">
        <h3 className="text-sm font-semibold text-slate-800 tracking-tight">{locationName}</h3>
      </div>

      {!showGrid ? (
        <div className="text-center py-12 text-slate-400 text-sm">Нет занятий на этой неделе</div>
      ) : (
        <WeeklyScheduleGrid
          weekStart={weekStart}
          lessons={lessons}
          getLessonTitle={getLessonTitle}
          getLessonSubtitle={getLessonSubtitle}
          onLessonClick={onLessonClick}
          onEmptyCellClick={onEmptyCellClick}
          canClickEmpty={canClickEmpty && !!locationId}
        />
      )}
    </section>
  );
}
