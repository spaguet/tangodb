import { addCalendarDays } from "./orgTime";

/** Allowed recurring rental pack lengths (calendar weeks, inclusive). */
export const RECURRING_PACK_WEEK_OPTIONS = [2, 3, 4] as const;

export type RecurringPackWeekCount = (typeof RECURRING_PACK_WEEK_OPTIONS)[number];

export const DEFAULT_RECURRING_PACK_WEEKS: RecurringPackWeekCount = 4;

export function isRecurringPackWeekCount(value: number): value is RecurringPackWeekCount {
  return (RECURRING_PACK_WEEK_OPTIONS as readonly number[]).includes(value);
}

/** Pack end date: valid_from + (weekCount × 7 − 1) calendar days. */
export function packValidToFromWeekCount(validFrom: string, weekCount: number): string {
  return addCalendarDays(validFrom, weekCount * 7 - 1);
}
