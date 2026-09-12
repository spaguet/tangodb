import { isValidDuration, slotEndOptions } from "./grid";

export type PackDayTimes = {
  timeStart: string;
  timeEnd: string;
};

export type PackDaySlotPayload = {
  weekday: number;
  time_start: string;
  time_end: string;
};

export function fallbackEnd(timeStart: string, preferred?: string): string {
  const ends = slotEndOptions(timeStart);
  if (preferred && ends.includes(preferred)) return preferred;
  return ends[0] ?? "";
}

export function ensureDayTimes(
  weekdays: number[],
  current: Record<number, PackDayTimes>,
  fallback: PackDayTimes
): Record<number, PackDayTimes> {
  const template =
    weekdays.map((d) => current[d]).find((t) => t && t.timeStart && t.timeEnd) ?? fallback;
  const next = { ...current };
  for (const d of weekdays) {
    if (!next[d]?.timeStart || !next[d]?.timeEnd) {
      next[d] = {
        timeStart: template.timeStart,
        timeEnd: fallbackEnd(template.timeStart, template.timeEnd),
      };
    }
  }
  return next;
}

export function toPackDaySlots(
  weekdays: number[],
  timesByDay: Record<number, PackDayTimes>
): PackDaySlotPayload[] {
  return [...weekdays]
    .sort((a, b) => a - b)
    .flatMap((weekday) => {
      const t = timesByDay[weekday];
      if (!t?.timeStart || !t?.timeEnd) return [];
      return [{ weekday, time_start: t.timeStart, time_end: t.timeEnd }];
    });
}

export function allPackDaySlotsValid(
  weekdays: number[],
  timesByDay: Record<number, PackDayTimes>
): boolean {
  if (weekdays.length === 0) return false;
  return weekdays.every((d) => {
    const t = timesByDay[d];
    return !!t && isValidDuration(t.timeStart, t.timeEnd);
  });
}

export function packDaySlotsHaveMixedHours(slots: PackDaySlotPayload[]): boolean {
  if (slots.length <= 1) return false;
  const first = `${slots[0].time_start}|${slots[0].time_end}`;
  return slots.some((s) => `${s.time_start}|${s.time_end}` !== first);
}
