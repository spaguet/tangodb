import { timeToMinutes } from "./scheduleWeek";
import type { DisplayLesson } from "../types";

export const ROW_HEIGHT_PX = 16;
export const SLOT_MINUTES = 15;

export interface PositionedLesson {
  lesson: DisplayLesson;
  column: number;
  columnCount: number;
}

export function timesOverlapLessons(a: DisplayLesson, b: DisplayLesson): boolean {
  return (
    timeToMinutes(a.timeStart) < timeToMinutes(b.timeEnd) &&
    timeToMinutes(b.timeStart) < timeToMinutes(a.timeEnd)
  );
}

/** Greedy column assignment for overlapping lessons in one day column. */
export function layoutDayLessons(lessons: DisplayLesson[]): PositionedLesson[] {
  if (lessons.length === 0) return [];

  const sorted = [...lessons].sort(
    (a, b) =>
      timeToMinutes(a.timeStart) - timeToMinutes(b.timeStart) ||
      timeToMinutes(a.timeEnd) - timeToMinutes(b.timeEnd)
  );

  const columnEnds: number[] = [];
  const columnByLesson = new Map<DisplayLesson, number>();

  for (const lesson of sorted) {
    const startMin = timeToMinutes(lesson.timeStart);
    let col = 0;
    while (col < columnEnds.length && columnEnds[col] > startMin) {
      col += 1;
    }
    if (col === columnEnds.length) {
      columnEnds.push(timeToMinutes(lesson.timeEnd));
    } else {
      columnEnds[col] = timeToMinutes(lesson.timeEnd);
    }
    columnByLesson.set(lesson, col);
  }

  const columnCount = Math.max(1, columnEnds.length);

  return sorted.map((lesson) => ({
    lesson,
    column: columnByLesson.get(lesson) ?? 0,
    columnCount,
  }));
}

export function lessonTopPx(timeStart: string, rangeStartMin: number): number {
  return ((timeToMinutes(timeStart) - rangeStartMin) / SLOT_MINUTES) * ROW_HEIGHT_PX;
}

export function lessonHeightPx(timeStart: string, timeEnd: string): number {
  const duration = timeToMinutes(timeEnd) - timeToMinutes(timeStart);
  return Math.max((duration / SLOT_MINUTES) * ROW_HEIGHT_PX, ROW_HEIGHT_PX);
}

export function gridHeightPx(rangeStartMin: number, rangeEndMin: number): number {
  return ((rangeEndMin - rangeStartMin) / SLOT_MINUTES) * ROW_HEIGHT_PX;
}
