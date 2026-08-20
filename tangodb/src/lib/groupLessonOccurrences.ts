import { DATE_CURSOR_MAX_ITERATIONS, isIsoDateString } from "./dateRecurrenceLimits";
import { addDays, nextOccurrenceOnOrAfter } from "./scheduleWeek";
import type { ScheduleSlot } from "../types";

/** Weekly occurrence dates for a group slot between rangeStart and rangeEnd (inclusive). */
export function computeWeeklyOccurrencesInRange(
  rangeStart: string,
  rangeEnd: string,
  dayOfWeek: number,
  validFrom: string,
  validTo: string | null
): string[] {
  if (!isIsoDateString(rangeStart) || !isIsoDateString(rangeEnd)) return [];
  if (rangeEnd < rangeStart) return [];
  if (!isIsoDateString(validFrom)) return [];
  if (validTo != null && !isIsoDateString(validTo)) return [];

  const dates: string[] = [];
  let current = nextOccurrenceOnOrAfter(rangeStart, dayOfWeek);
  if (!isIsoDateString(current)) return [];

  let iterations = 0;
  while (current <= rangeEnd) {
    if (++iterations > DATE_CURSOR_MAX_ITERATIONS) break;

    if (current >= validFrom && (validTo == null || current <= validTo)) {
      dates.push(current);
    }
    current = addDays(current, 7);
    if (!isIsoDateString(current)) break;
  }

  return dates;
}

export function isRecurringSlotForCancel(validFrom: string, validTo: string | null): boolean {
  return validTo == null || validTo > validFrom;
}

export function computeSlotOccurrencesInRange(
  slot: Pick<ScheduleSlot, "dayOfWeek" | "validFrom" | "validTo">,
  rangeStart: string,
  rangeEnd: string
): string[] {
  if (!isRecurringSlotForCancel(slot.validFrom, slot.validTo)) return [];
  if (rangeEnd < rangeStart) return [];
  if (slot.validTo != null && rangeStart > slot.validTo) return [];
  if (rangeEnd < slot.validFrom) return [];

  const effectiveEnd = slot.validTo != null && slot.validTo < rangeEnd ? slot.validTo : rangeEnd;
  const effectiveStart = rangeStart < slot.validFrom ? slot.validFrom : rangeStart;

  return computeWeeklyOccurrencesInRange(
    effectiveStart,
    effectiveEnd,
    slot.dayOfWeek,
    slot.validFrom,
    slot.validTo
  );
}

export interface TeacherVacationPreviewItem {
  slotId: string;
  groupName?: string;
  disciplineId: string | null;
  locationId: string | null;
  timeStart: string;
  timeEnd: string;
  dates: string[];
}

export function computeTeacherVacationPreview(
  slots: ScheduleSlot[],
  teacherMemberId: string,
  rangeStart: string,
  rangeEnd: string
): TeacherVacationPreviewItem[] {
  if (rangeEnd < rangeStart) return [];

  const items: TeacherVacationPreviewItem[] = [];

  for (const slot of slots) {
    if (!slot.id || slot.teacherMemberId !== teacherMemberId) continue;

    const dates = computeSlotOccurrencesInRange(slot, rangeStart, rangeEnd);
    if (dates.length === 0) continue;

    items.push({
      slotId: slot.id,
      groupName: slot.groupName,
      disciplineId: slot.disciplineId ?? null,
      locationId: slot.locationId ?? null,
      timeStart: slot.time,
      timeEnd: slot.timeEnd,
      dates,
    });
  }

  return items.sort(
    (a, b) =>
      a.dates[0]?.localeCompare(b.dates[0] ?? "") ||
      a.timeStart.localeCompare(b.timeStart) ||
      (a.groupName ?? "").localeCompare(b.groupName ?? "")
  );
}

export function flattenTeacherVacationPreview(items: TeacherVacationPreviewItem[]): string[] {
  return items.flatMap((item) => item.dates).sort();
}
