import { isMiniAppDurationValid, miniAppEndOptions } from "./miniAppBookingGrid";

export type MiniAppPackDayTimes = {
  timeStart: string;
  timeEnd: string;
};

export type MiniAppPackDaySlot = {
  weekday: number;
  time_start: string;
  time_end: string;
};

export function miniAppFallbackEnd(timeStart: string, preferred?: string): string {
  const ends = miniAppEndOptions(timeStart);
  if (preferred && ends.includes(preferred)) return preferred;
  return ends[0] ?? "";
}

export function ensureMiniAppDayTimes(
  weekdays: number[],
  current: Record<number, MiniAppPackDayTimes>,
  fallback: MiniAppPackDayTimes
): Record<number, MiniAppPackDayTimes> {
  const template =
    weekdays.map((d) => current[d]).find((t) => t && t.timeStart && t.timeEnd) ?? fallback;
  const next = { ...current };
  for (const d of weekdays) {
    if (!next[d]?.timeStart || !next[d]?.timeEnd) {
      next[d] = {
        timeStart: template.timeStart,
        timeEnd: miniAppFallbackEnd(template.timeStart, template.timeEnd),
      };
    }
  }
  return next;
}

export function toMiniAppPackDaySlots(
  weekdays: number[],
  timesByDay: Record<number, MiniAppPackDayTimes>
): MiniAppPackDaySlot[] {
  return [...weekdays]
    .sort((a, b) => a - b)
    .flatMap((weekday) => {
      const t = timesByDay[weekday];
      if (!t?.timeStart || !t?.timeEnd) return [];
      return [{ weekday, time_start: t.timeStart, time_end: t.timeEnd }];
    });
}

export function allMiniAppPackDaySlotsValid(
  weekdays: number[],
  timesByDay: Record<number, MiniAppPackDayTimes>
): boolean {
  if (weekdays.length === 0) return false;
  return weekdays.every((d) => {
    const t = timesByDay[d];
    return !!t && isMiniAppDurationValid(t.timeStart, t.timeEnd);
  });
}
