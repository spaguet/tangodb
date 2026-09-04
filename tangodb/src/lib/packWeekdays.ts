/** ISO weekday 1=Mon … 7=Sun for a calendar date (UTC noon). */
export function isoWeekdayFromDate(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dow = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

/** Ensure the weekday of validFrom is included after the start date changes. */
export function weekdaysIncludingDate(weekdays: number[], isoDate: string): number[] {
  const wd = isoWeekdayFromDate(isoDate);
  if (weekdays.includes(wd)) return weekdays;
  return [...weekdays, wd].sort((a, b) => a - b);
}

export function validFromInWeekdays(validFrom: string, weekdays: number[]): boolean {
  if (!validFrom || weekdays.length === 0) return false;
  return weekdays.includes(isoWeekdayFromDate(validFrom));
}
