import { useEffect, useRef, useState } from "react";
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
  highlightedLesson?: DisplayLesson | null;
  forExport?: boolean;
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
  highlightedLesson = null,
  forExport = false,
}: LocationScheduleSectionProps) {
  const { t } = useI18n();
  const sectionRef = useRef<HTMLElement>(null);
  const [isExpanded, setIsExpanded] = useState(forceExpanded);

  useEffect(() => {
    if (!forceExpanded) return;
    setIsExpanded(true);
    if (forExport) return;
    const node = sectionRef.current;
    if (!node) return;
    window.requestAnimationFrame(() => {
      node.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [forceExpanded, forExport]);

  const showGrid = forExport || lessons.length > 0 || (canClickEmpty && locationId);
  const showContent = forExport || isExpanded;

  const header = (
    <>
      <h3 className="text-sm font-semibold text-slate-800 tracking-tight min-w-0 truncate">
        {locationName}
      </h3>
      {!forExport ? (
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
      ) : null}
    </>
  );

  return (
    <section ref={sectionRef} className="bg-white rounded-xl border border-slate-200/90 shadow-xs">
      {forExport ? (
        <div className="w-full flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50/60 rounded-t-xl">
          {header}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50/60 text-left cursor-pointer hover:bg-slate-50 transition-colors rounded-t-xl"
          aria-expanded={isExpanded}
        >
          {header}
        </button>
      )}

      {showContent &&
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
            highlightedLesson={highlightedLesson}
            forExport={forExport}
          />
        ))}
    </section>
  );
}
