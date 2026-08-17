import { useMemo } from "react";
import { dowShort, jsDayToIsoDow } from "../../lib/utils";
import { useI18n } from "../../hooks/useI18n";
import { timeToMinutes, toISODateLocal } from "../../lib/scheduleWeek";
import type { DisplayLesson } from "../../types";
import {
  gridHeightPx,
  layoutDayLessons,
  ROW_HEIGHT_PX,
  SLOT_MINUTES,
} from "../../lib/scheduleLayout";
import LessonBlock from "./LessonBlock";

interface DayColumnProps {
  dateISO: string;
  dayOfWeek: number;
  dayNumber: number;
  isToday?: boolean;
  lessons: DisplayLesson[];
  rangeStartMin: number;
  rangeEndMin: number;
  getLessonTitle: (lesson: DisplayLesson) => string;
  getLessonSubtitle: (lesson: DisplayLesson) => string | undefined;
  onLessonClick?: (lesson: DisplayLesson) => void;
  onEmptyCellClick?: (dateISO: string, dayOfWeek: number, timeStart: string) => void;
  canClickEmpty?: boolean;
  highlightedLesson?: DisplayLesson | null;
}

function isMinuteOccupied(minute: number, lessons: DisplayLesson[]): boolean {
  return lessons.some(
    (l) => timeToMinutes(l.timeStart) <= minute && minute < timeToMinutes(l.timeEnd)
  );
}

export default function DayColumn({
  dateISO,
  dayOfWeek,
  dayNumber,
  isToday = false,
  lessons,
  rangeStartMin,
  rangeEndMin,
  getLessonTitle,
  getLessonSubtitle,
  onLessonClick,
  onEmptyCellClick,
  canClickEmpty = false,
  highlightedLesson = null,
}: DayColumnProps) {
  const { t, locale } = useI18n();
  const positioned = useMemo(() => layoutDayLessons(lessons), [lessons]);
  const gridHeight = gridHeightPx(rangeStartMin, rangeEndMin);
  const rowCount = (rangeEndMin - rangeStartMin) / SLOT_MINUTES;

  const emptySlots = useMemo(() => {
    if (!canClickEmpty || !onEmptyCellClick) return [];
    const slots: { top: number; timeStart: string }[] = [];
    for (let min = rangeStartMin; min < rangeEndMin; min += SLOT_MINUTES) {
      if (isMinuteOccupied(min, lessons)) continue;
      slots.push({
        top: ((min - rangeStartMin) / SLOT_MINUTES) * ROW_HEIGHT_PX,
        timeStart: formatTimeLabel(min),
      });
    }
    return slots;
  }, [canClickEmpty, onEmptyCellClick, rangeStartMin, rangeEndMin, lessons]);

  const hourLines = useMemo(() => {
    const lines: number[] = [];
    for (let min = rangeStartMin; min < rangeEndMin; min += 60) {
      if (min > rangeStartMin) {
        lines.push(((min - rangeStartMin) / SLOT_MINUTES) * ROW_HEIGHT_PX);
      }
    }
    return lines;
  }, [rangeStartMin, rangeEndMin]);

  return (
    <div className="flex-1 min-w-0 border-l border-ink-100 first:border-l-0">
      <div
        className={`sticky top-0 z-[1] flex h-9 sm:h-11 flex-col items-center justify-center border-b border-ink-100 px-0.5 sm:px-1 backdrop-blur-[2px] shadow-[0_2px_4px_-2px_rgba(15,23,42,0.08)] ${
          isToday ? "bg-ink-200/10" : "bg-ink-50/10"
        }`}
      >
        <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-500 leading-none">
          {dowShort(dayOfWeek, locale)}
        </div>
        <div className="text-xs sm:text-sm font-semibold text-ink-800 tabular-nums leading-tight">
          {dayNumber}
        </div>
      </div>

      <div
        className={`relative ${isToday ? "bg-ink-100/10" : "bg-white"}`}
        style={{ height: gridHeight }}
      >
        {Array.from({ length: rowCount }, (_, i) => (
          <div
            key={i}
            className={`absolute left-0 right-0 border-b border-ink-50 ${
              i % 4 === 0 ? "border-ink-100" : ""
            }`}
            style={{ top: i * ROW_HEIGHT_PX, height: ROW_HEIGHT_PX }}
          />
        ))}

        {hourLines.map((top) => (
          <div
            key={top}
            className="absolute left-0 right-0 border-t border-ink-200 pointer-events-none"
            style={{ top }}
          />
        ))}

        {emptySlots.map(({ top, timeStart }) => (
          <button
            key={timeStart}
            type="button"
            aria-label={t("common.aria.addLesson", { time: timeStart })}
            onClick={() => onEmptyCellClick?.(dateISO, dayOfWeek, timeStart)}
            className="absolute left-0 right-0 z-0 hover:bg-gold-50/10 transition-colors cursor-pointer border-0 bg-transparent p-0"
            style={{ top, height: ROW_HEIGHT_PX }}
          />
        ))}

        {positioned.map((item) => (
          <LessonBlock
            key={
              item.lesson.kind === "group"
                ? `${item.lesson.slotId}-${item.lesson.date}`
                : item.lesson.kind === "event"
                  ? `${item.lesson.sessionId}-${item.lesson.date}`
                  : item.lesson.kind === "rental"
                    ? `${item.lesson.rentalId}-${item.lesson.date}`
                    : item.lesson.lessonId
            }
            item={item}
            rangeStartMin={rangeStartMin}
            title={getLessonTitle(item.lesson)}
            subtitle={getLessonSubtitle(item.lesson)}
            onClick={onLessonClick}
            highlighted={
              highlightedLesson != null &&
              ((highlightedLesson.kind === "personal" &&
                item.lesson.kind === "personal" &&
                item.lesson.lessonId === highlightedLesson.lessonId) ||
                (highlightedLesson.kind === "rental" &&
                  item.lesson.kind === "rental" &&
                  item.lesson.rentalId === highlightedLesson.rentalId))
            }
          />
        ))}
      </div>
    </div>
  );
}

export function formatTimeLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function buildDayColumns(
  weekStart: Date,
  lessons: DisplayLesson[]
): { dateISO: string; dayOfWeek: number; dayNumber: number; lessons: DisplayLesson[] }[] {
  const columns: { dateISO: string; dayOfWeek: number; dayNumber: number; lessons: DisplayLesson[] }[] =
    [];

  for (let offset = 0; offset < 7; offset += 1) {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + offset);
    const dateISO = toISODateLocal(date);
    const dayOfWeek = jsDayToIsoDow(date.getDay());

    columns.push({
      dateISO,
      dayOfWeek,
      dayNumber: date.getDate(),
      lessons: lessons.filter((l) => l.date === dateISO),
    });
  }

  return columns;
}
