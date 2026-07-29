import { addDays, nextOccurrenceOnOrAfter } from "./scheduleWeek";

/** Weekly occurrence dates for a group slot between rangeStart and rangeEnd (inclusive). */
export function computeWeeklyOccurrencesInRange(
  rangeStart: string,
  rangeEnd: string,
  dayOfWeek: number,
  validFrom: string,
  validTo: string | null
): string[] {
  if (rangeEnd < rangeStart) return [];

  const dates: string[] = [];
  let current = nextOccurrenceOnOrAfter(rangeStart, dayOfWeek);

  while (current <= rangeEnd) {
    if (current >= validFrom && (validTo == null || current <= validTo)) {
      dates.push(current);
    }
    current = addDays(current, 7);
  }

  return dates;
}
