import type { GroupRepeatConfig } from "./groupLessonRepeat";
import { DATE_CURSOR_MAX_ITERATIONS, isIsoDateString } from "./dateRecurrenceLimits";
import { addDays, getWeekRange, nextOccurrenceOnOrAfter, toISODateLocal } from "./scheduleWeek";
import { jsDayToIsoDow } from "./utils";

export interface PersonalLessonSlot {
  date: string;
  timeStart: string;
  timeEnd: string;
}

export interface WeeklyRecurrenceRow {
  dayOfWeek: number;
  timeStart: string;
  timeEnd: string;
}

/** Collapse duplicate weekday+time patterns (e.g. two Thursdays at 14:00 → one row). */
export function uniqueWeeklyRecurrenceRows(rows: WeeklyRecurrenceRow[]): WeeklyRecurrenceRow[] {
  const seen = new Set<string>();
  const result: WeeklyRecurrenceRow[] = [];
  for (const row of rows) {
    const key = `${row.dayOfWeek}|${row.timeStart}|${row.timeEnd}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }
  return result;
}

export function groupSlotsByTime(slots: PersonalLessonSlot[]): Array<{
  dates: string[];
  timeStart: string;
  timeEnd: string;
}> {
  const map = new Map<string, string[]>();
  for (const slot of slots) {
    const key = `${slot.timeStart}\0${slot.timeEnd}`;
    const list = map.get(key) ?? [];
    list.push(slot.date);
    map.set(key, list);
  }
  return Array.from(map.entries()).map(([key, dates]) => {
    const [timeStart, timeEnd] = key.split("\0");
    return { dates: [...new Set(dates)].sort(), timeStart, timeEnd };
  });
}

/** Dates from manual entries that fall after the recurrence end date. */
export function findLessonEntriesBeyondEndDate(
  entries: Array<{ date: string }>,
  endDate: string
): string[] {
  return entries.filter((e) => e.date > endDate).map((e) => e.date);
}
export function expandWeeklyRecurrence(
  startDate: string,
  endDate: string,
  rows: WeeklyRecurrenceRow[]
): PersonalLessonSlot[] {
  if (!rows.length) return [];
  if (!isIsoDateString(startDate) || !isIsoDateString(endDate)) return [];
  if (startDate > endDate) return [];

  const slots: PersonalLessonSlot[] = [];
  const seen = new Set<string>();

  let { weekStart } = getWeekRange(new Date(`${startDate}T12:00:00`));

  let iterations = 0;
  while (toISODateLocal(weekStart) <= endDate) {
    if (++iterations > DATE_CURSOR_MAX_ITERATIONS) break;

    const weekStartISO = toISODateLocal(weekStart);
    if (!isIsoDateString(weekStartISO)) break;

    for (const row of rows) {
      const date = nextOccurrenceOnOrAfter(weekStartISO, row.dayOfWeek);
      if (!isIsoDateString(date) || date < startDate || date > endDate) continue;
      const key = `${date}|${row.timeStart}|${row.timeEnd}`;
      if (seen.has(key)) continue;
      seen.add(key);
      slots.push({ date, timeStart: row.timeStart, timeEnd: row.timeEnd });
    }
    weekStart = new Date(weekStart);
    weekStart.setDate(weekStart.getDate() + 7);
  }

  return slots.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.timeStart.localeCompare(b.timeStart) ||
      a.timeEnd.localeCompare(b.timeEnd)
  );
}

export function expandWeeklyRecurrenceByWeekCount(
  startDate: string,
  weekCount: number,
  rows: WeeklyRecurrenceRow[]
): PersonalLessonSlot[] {
  if (weekCount < 1) return [];
  const endDate = addDays(startDate, weekCount * 7 - 1);
  return expandWeeklyRecurrence(startDate, endDate, rows);
}

export function expandPersonalLessonWeeklySlots(
  startDate: string,
  timeStart: string,
  timeEnd: string,
  config: Pick<GroupRepeatConfig, "repeatWeekly" | "endMode" | "weekCount" | "endDate">
): PersonalLessonSlot[] {
  if (!config.repeatWeekly) {
    return [{ date: startDate, timeStart, timeEnd }];
  }

  const rows = uniqueWeeklyRecurrenceRows([
    {
      dayOfWeek: jsDayToIsoDow(new Date(`${startDate}T12:00:00`).getDay()),
      timeStart,
      timeEnd,
    },
  ]);

  if (config.endMode === "weeks") {
    return expandWeeklyRecurrenceByWeekCount(startDate, config.weekCount, rows);
  }

  return expandWeeklyRecurrence(startDate, config.endDate, rows);
}
