import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";
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
  forceExpanded?: boolean;
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
  forceExpanded = false,
}: LocationScheduleSectionProps) {
  const { t } = useI18n();
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (forceExpanded) setIsExpanded(true);
  }, [forceExpanded]);

  const showGrid = lessons.length > 0 || (canClickEmpty && locationId);

  return (
    <section className="bg-white rounded-xl border border-slate-200/90 shadow-xs">
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50/60 text-left cursor-pointer hover:bg-slate-50 transition-colors rounded-t-xl"
        aria-expanded={isExpanded}
      >
        <h3 className="text-sm font-semibold text-slate-800 tracking-tight min-w-0 truncate">
          {locationName}
        </h3>
        <div className="flex items-center gap-2 shrink-0">
          {lessons.length > 0 ? (
            <span className="text-xs text-slate-500 tabular-nums">{lessons.length}</span>
          ) : null}
          <ChevronDown
            className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${
              isExpanded ? "rotate-180" : ""
            }`}
          />
        </div>
      </button>

      {isExpanded &&
        (!showGrid ? (
          <div className="text-center py-12 text-slate-400 text-sm">{t("common.noLessonsWeek")}</div>
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
        ))}
    </section>
  );
}
