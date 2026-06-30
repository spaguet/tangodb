import { addDays } from "./scheduleWeek";
import type { GroupDisplayLesson, ScheduleSlot } from "../types";

export interface GroupSlotEditRow {
  key: string;
  id: string;
  dayOfWeek: number;
  timeStart: string;
  timeEnd: string;
}

function slotCoversDate(slot: ScheduleSlot, date: string): boolean {
  const validFrom = slot.validFrom ?? "2000-01-01";
  if (validFrom > date) return false;
  if (slot.validTo != null && slot.validTo < date) return false;
  return true;
}

function isActiveSlot(slot: ScheduleSlot): boolean {
  return slot.validTo == null;
}

/** Prefer the slot that should be edited for a given day (active successor > active current > closed). */
export function pickBestSlotForDay(
  slots: ScheduleSlot[],
  dayOfWeek: number,
  editDate: string
): ScheduleSlot | undefined {
  const daySlots = slots.filter((slot) => slot.id && slot.dayOfWeek === dayOfWeek);
  if (daySlots.length === 0) return undefined;

  const successorFrom = editDate;

  const activeSuccessor = daySlots.find(
    (slot) => isActiveSlot(slot) && slot.validFrom === successorFrom
  );
  if (activeSuccessor) return activeSuccessor;

  const activeCurrent = daySlots.find(
    (slot) => isActiveSlot(slot) && (slot.validFrom ?? "2000-01-01") <= editDate
  );
  if (activeCurrent) return activeCurrent;

  const anyActive = daySlots.find((slot) => isActiveSlot(slot));
  if (anyActive) return anyActive;

  return daySlots.find((slot) => slotCoversDate(slot, editDate));
}

function relatedGroupSlots(lesson: GroupDisplayLesson, scheduleSlots: ScheduleSlot[]): ScheduleSlot[] {
  const scheduleGroupId = lesson.scheduleGroupId;
  if (scheduleGroupId) {
    return scheduleSlots.filter(
      (slot) => slot.id && slot.scheduleGroupId === scheduleGroupId
    );
  }

  const groupName = (lesson.groupName ?? "").trim();
  return scheduleSlots.filter((slot) => {
    if (!slot.id) return false;
    if ((slot.locationId ?? null) !== lesson.locationId) return false;
    if ((slot.disciplineId ?? null) !== lesson.disciplineId) return false;
    return (slot.groupName ?? "").trim() === groupName;
  });
}

/** Rows for the group-lesson edit form: one editable slot per weekday, active versions preferred. */
export function pickGroupSlotsForEdit(
  lesson: GroupDisplayLesson,
  scheduleSlots: ScheduleSlot[],
  editDate: string = lesson.date
): GroupSlotEditRow[] {
  const related = relatedGroupSlots(lesson, scheduleSlots);

  const dayOfWeeks = new Set<number>([lesson.dayOfWeek]);
  for (const slot of related) {
    dayOfWeeks.add(slot.dayOfWeek);
  }

  const rows: GroupSlotEditRow[] = [];
  for (const dayOfWeek of dayOfWeeks) {
    const slot =
      pickBestSlotForDay(related, dayOfWeek, editDate) ??
      (dayOfWeek === lesson.dayOfWeek
        ? scheduleSlots.find((item) => item.id === lesson.slotId)
        : undefined);

    if (!slot?.id) continue;

    rows.push({
      key: slot.id,
      id: slot.id,
      dayOfWeek: slot.dayOfWeek,
      timeStart: slot.time,
      timeEnd: slot.timeEnd,
    });
  }

  if (rows.length > 0) {
    return rows.sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  }

  return [
    {
      key: lesson.slotId,
      id: lesson.slotId,
      dayOfWeek: lesson.dayOfWeek,
      timeStart: lesson.timeStart,
      timeEnd: lesson.timeEnd,
    },
  ];
}
