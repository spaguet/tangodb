import { useEffect, useMemo, useRef, useState } from "react";
import { computeDisplayRange, toISODateLocal } from "../../lib/scheduleWeek";
import { dowShort } from "../../lib/utils";
import { useI18n } from "../../hooks/useI18n";
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

function useNarrowScheduleViewport(): boolean {
  const [narrow, setNarrow] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 639px)").matches;
  });

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return narrow;
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
  const { locale } = useI18n();
  const narrow = useNarrowScheduleViewport();
  const scrollRef = useRef<HTMLDivElement>(null);

  const { start: rangeStartMin, end: rangeEndMin } = useMemo(
    () => computeDisplayRange(lessons),
    [lessons]
  );

  const dayColumns = useMemo(() => buildDayColumns(weekStart, lessons), [weekStart, lessons]);
  const todayISO = useMemo(() => toISODateLocal(new Date()), []);
  const gridHeight = gridHeightPx(rangeStartMin, rangeEndMin);
  const rowCount = (rangeEndMin - rangeStartMin) / SLOT_MINUTES;

  const weekHasToday = dayColumns.some((col) => col.dateISO === todayISO);
  const defaultMobileDayISO = weekHasToday ? todayISO : dayColumns[0]?.dateISO ?? todayISO;

  const [mobileDayISO, setMobileDayISO] = useState(defaultMobileDayISO);

  useEffect(() => {
    setMobileDayISO(defaultMobileDayISO);
  }, [defaultMobileDayISO, weekStart]);

  const visibleColumns = useMemo(() => {
    if (!narrow) return dayColumns;
    return dayColumns.filter((col) => col.dateISO === mobileDayISO);
  }, [narrow, dayColumns, mobileDayISO]);

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

  useEffect(() => {
    if (narrow) return;
    const node = scrollRef.current;
    if (!node) return;
    const todayEl = node.querySelector('[data-schedule-today="true"]');
    if (!todayEl) return;
    window.requestAnimationFrame(() => {
      todayEl.scrollIntoView({ behavior: "auto", block: "nearest", inline: "center" });
    });
  }, [narrow, weekStart, todayISO]);

  return (
    <div className="space-y-2">
      {narrow ? (
        <div
          className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1 snap-x snap-mandatory [-webkit-overflow-scrolling:touch]"
          role="tablist"
          aria-label="Day"
        >
          {dayColumns.map((col) => {
            const selected = col.dateISO === mobileDayISO;
            return (
              <button
                key={col.dateISO}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setMobileDayISO(col.dateISO)}
                className={`shrink-0 snap-start min-w-[3.25rem] rounded-lg border px-2 py-1.5 text-center transition-colors cursor-pointer ${
                  selected
                    ? "border-indigo-300 bg-indigo-50 text-indigo-900"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                } ${col.dateISO === todayISO ? "ring-1 ring-slate-300" : ""}`}
              >
                <div className="text-[10px] font-semibold uppercase tracking-wider opacity-80">
                  {dowShort(col.dayOfWeek, locale)}
                </div>
                <div className="text-sm font-semibold tabular-nums">{col.dayNumber}</div>
              </button>
            );
          })}
        </div>
      ) : null}

      <div
        ref={scrollRef}
        className="isolate overflow-auto max-h-[min(52vh,480px)] sm:max-h-[70dvh] sm:overflow-x-auto sm:overflow-y-auto [-webkit-overflow-scrolling:touch]"
      >
        <div className={`flex ${narrow ? "min-w-0" : "min-w-[640px]"}`}>
          <div className="sticky left-0 z-20 w-10 sm:w-12 shrink-0 border-r border-slate-100 bg-white shadow-[2px_0_4px_-2px_rgba(15,23,42,0.08)]">
            <div
              className="sticky top-0 z-30 h-9 sm:h-11 border-b border-slate-100 bg-slate-50/95 backdrop-blur-[2px]"
              aria-hidden
            />
            <div className="relative" style={{ height: gridHeight }}>
              {Array.from({ length: rowCount }, (_, i) => (
                <div
                  key={i}
                  className="absolute left-0 right-0 border-b border-slate-50"
                  style={{ top: i * ROW_HEIGHT_PX, height: ROW_HEIGHT_PX }}
                />
              ))}
              {timeLabels.map(({ top, label }) => (
                <div
                  key={label}
                  className="absolute right-0.5 sm:right-1 z-10 bg-white pl-0.5 text-[10px] font-semibold text-slate-400 tabular-nums leading-none -translate-y-full"
                  style={{ top }}
                >
                  {label}
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-1 min-w-0">
            {visibleColumns.map((col) => (
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
    </div>
  );
}
