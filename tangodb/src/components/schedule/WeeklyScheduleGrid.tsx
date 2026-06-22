import { useMemo } from "react";
import { computeDisplayRange } from "../../lib/scheduleWeek";
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
}

export default function WeeklyScheduleGrid({
  weekStart,
  lessons,
  getLessonTitle,
  getLessonSubtitle,
  onLessonClick,
  onEmptyCellClick,
  canClickEmpty = false,
}: WeeklyScheduleGridProps) {
  const { start: rangeStartMin, end: rangeEndMin } = useMemo(
    () => computeDisplayRange(lessons),
    [lessons]
  );

  const dayColumns = useMemo(() => buildDayColumns(weekStart, lessons), [weekStart, lessons]);
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
    <div className="overflow-x-auto">
      <div className="flex min-w-[640px]">
        <div className="w-12 shrink-0 border-r border-slate-100">
          <div className="h-[52px] border-b border-slate-100 bg-slate-50/80" />
          <div className="relative" style={{ height: gridHeight }}>
            {timeLabels.map(({ top, label }) => (
              <div
                key={label}
                className="absolute right-1 text-[10px] font-semibold text-slate-400 tabular-nums -translate-y-1/2"
                style={{ top }}
              >
                {label}
              </div>
            ))}
            {Array.from({ length: rowCount }, (_, i) => (
              <div
                key={i}
                className="absolute left-0 right-0 border-b border-slate-50"
                style={{ top: i * ROW_HEIGHT_PX, height: ROW_HEIGHT_PX }}
              />
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
              lessons={col.lessons}
              rangeStartMin={rangeStartMin}
              rangeEndMin={rangeEndMin}
              getLessonTitle={getLessonTitle}
              getLessonSubtitle={getLessonSubtitle}
              onLessonClick={onLessonClick}
              onEmptyCellClick={onEmptyCellClick}
              canClickEmpty={canClickEmpty}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
