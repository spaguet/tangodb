import { computeWeeklyOccurrencesInRange } from "./groupLessonOccurrences";
import { maxRepeatEndDate } from "./dateRecurrenceLimits";
import type { GroupDisplayLesson } from "../types";
import { relatedGroupSlots, type GroupScheduleSlotRef } from "./scheduleSlotEdit";

export function groupSlotOccurrencesFromDate(lesson: GroupDisplayLesson): string[] {
  const rangeEnd = lesson.validTo ?? maxRepeatEndDate(lesson.date);
  return computeWeeklyOccurrencesInRange(
    lesson.date,
    rangeEnd,
    lesson.dayOfWeek,
    lesson.validFrom,
    lesson.validTo
  );
}

export function activeRelatedGroupSlots(
  lesson: GroupDisplayLesson,
  scheduleSlots: GroupScheduleSlotRef[]
): GroupScheduleSlotRef[] {
  return relatedGroupSlots(lesson, scheduleSlots).filter(
    (slot) => slot.validTo == null || (slot.validFrom != null && slot.validTo > slot.validFrom)
  );
}

export function canDeleteEntireGroupScheduleFromDate(
  lesson: GroupDisplayLesson,
  scheduleSlots: GroupScheduleSlotRef[]
): boolean {
  return activeRelatedGroupSlots(lesson, scheduleSlots).length > 1;
}
