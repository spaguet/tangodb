import { useMemo } from "react";
import { computeDisplayRange, toISODateLocal } from "../../lib/scheduleWeek";
import type { DisplayLesson } from "../../types";
import {
  gridHeightPx,
  ROW_HEIGHT_PX,
  SLOT_MINUTES,
} from "../../lib/scheduleLayout";
import DayColumn, { buildDayColumns, formatTimeLabel } from "./DayColumn";

interface WeeklyScheduleGridProps {
  weekStart: Date;
  lessons: DisplayLesson[];
  getLessonTitle: (lesson: DisplayLesson) => string;
  getLessonSubtitle: (lesson: DisplayLesson) => string | undefined;
  onLessonClick?: (lesson: DisplayLesson) => void;
  onEmptyCellClick?: (dateISO: string, dayOfWeek: number, timeStart: string) => void;
  canClickEmpty?: boolean;
  highlightedLesson?: DisplayLesson | null;
}

export default function WeeklyScheduleGrid({
  weekStart,
  lessons,
  getLessonTitle,
  getLessonSubtitle,
  onLessonClick,
  onEmptyCellClick,
  canClickEmpty = false,
  highlightedLesson = null,
}: WeeklyScheduleGridProps) {
  const { start: rangeStartMin, end: rangeEndMin } = useMemo(
    () => computeDisplayRange(lessons),
    [lessons]
  );

  const dayColumns = useMemo(() => buildDayColumns(weekStart, lessons), [weekStart, lessons]);
  const todayISO = useMemo(() => toISODateLocal(new Date()), []);
  const gridHeight = gridHeightPx(rangeStartMin, rangeEndMin);
  const rowCount = (rangeEndMin - rangeStartMin) / SLOT_MINUTES;

  const timeLabels = useMemo(() => {
    const labels: { top: number; label: string }[] = [];
    for (let min = rangeStartMin; min < rangeEndMin; min += 60) {
      labels.push({
        top: ((min - rangeStartMin) / SLOT_MINUTES) * ROW_HEIGHT_PX,
        label: formatTimeLabel(min),
      });
    }
    return labels;
  }, [rangeStartMin, rangeEndMin]);

  return (
    <div className="isolate overflow-auto max-h-[70dvh] sm:max-h-none sm:overflow-x-auto sm:overflow-y-auto [-webkit-overflow-scrolling:touch]">
      <div className="flex min-w-[640px]">
        <div className="sticky left-0 z-20 w-10 sm:w-12 shrink-0 border-r border-ink-100 bg-white shadow-[2px_0_4px_-2px_rgba(15,23,42,0.08)]">
          <div
            className="sticky top-0 z-30 h-9 sm:h-11 border-b border-ink-100 bg-ink-50/10 backdrop-blur-[2px]"
            aria-hidden
          />
          <div className="relative" style={{ height: gridHeight }}>
            {Array.from({ length: rowCount }, (_, i) => (
              <div
                key={i}
                className="absolute left-0 right-0 border-b border-ink-50"
                style={{ top: i * ROW_HEIGHT_PX, height: ROW_HEIGHT_PX }}
              />
            ))}
            {timeLabels.map(({ top, label }) => (
              <div
                key={label}
                className="absolute right-0.5 sm:right-1 z-10 bg-white pl-0.5 text-[10px] font-semibold text-ink-400 tabular-nums leading-none -translate-y-full"
                style={{ top }}
              >
                {label}
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-1 min-w-0">
          {dayColumns.map((col) => (
            <DayColumn
              key={col.dateISO}
              dateISO={col.dateISO}
              dayOfWeek={col.dayOfWeek}
              dayNumber={col.dayNumber}
              isToday={col.dateISO === todayISO}
              lessons={col.lessons}
              rangeStartMin={rangeStartMin}
              rangeEndMin={rangeEndMin}
              getLessonTitle={getLessonTitle}
              getLessonSubtitle={getLessonSubtitle}
              onLessonClick={onLessonClick}
              onEmptyCellClick={onEmptyCellClick}
              canClickEmpty={canClickEmpty}
              highlightedLesson={highlightedLesson}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
