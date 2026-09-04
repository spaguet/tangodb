import { orgIsoWeekday } from "./orgTime";

/** Ensure the weekday of validFrom is included after the start date changes. */
export function weekdaysIncludingDate(
  weekdays: number[],
  timezone: string,
  isoDate: string
): number[] {
  const wd = orgIsoWeekday(timezone, isoDate);
  if (weekdays.includes(wd)) return weekdays;
  return [...weekdays, wd].sort((a, b) => a - b);
}

export function validFromInWeekdays(
  timezone: string,
  validFrom: string,
  weekdays: number[]
): boolean {
  if (!validFrom || weekdays.length === 0) return false;
  return weekdays.includes(orgIsoWeekday(timezone, validFrom));
}
