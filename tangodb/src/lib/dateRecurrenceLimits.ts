import { addDays, toISODateLocal } from "./scheduleWeek";

/** YYYY-MM-DD */
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Max weekly-repeat lesson slots (personal sale / freebusy). */
export const WEEKLY_RECURRENCE_SLOT_CAP = 52;

/** Max occurrence dates in vacation / group-cancel preview. */
export const RANGE_PREVIEW_DATE_CAP = 200;

/** Safety bound for date cursor while-loops (~5 years of weeks). */
export const DATE_CURSOR_MAX_ITERATIONS = 260;

/** Default horizon for repeat end DatePicker (months from anchor). */
export const REPEAT_END_MAX_MONTHS = 12;

/** Edge Function invoke timeout for Google freebusy checks. */
export const FREEBUSY_INVOKE_TIMEOUT_MS = 15_000;

export function isIsoDateString(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return (
    date.getFullYear() === y &&
    date.getMonth() === m - 1 &&
    date.getDate() === d
  );
}

export function addMonthsIso(isoDate: string, months: number): string {
  if (!isIsoDateString(isoDate)) return isoDate;
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(y, m - 1 + months, d);
  return toISODateLocal(date);
}

/** Latest allowed repeat-end date: anchor + N months (inclusive). */
export function maxRepeatEndDate(anchorIso: string, months = REPEAT_END_MAX_MONTHS): string {
  if (!isIsoDateString(anchorIso)) return anchorIso;
  return addMonthsIso(anchorIso, months);
}

export function exceedsWeeklySlotCap(count: number): boolean {
  return count > WEEKLY_RECURRENCE_SLOT_CAP;
}

export function exceedsRangePreviewCap(count: number): boolean {
  return count > RANGE_PREVIEW_DATE_CAP;
}
