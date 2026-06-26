import { jsDayToIsoDow } from "./utils";
import { t, formatDateLocale } from "./i18n";
import type { I18nKey } from "./i18n/keys";
import type { TranslateFn } from "./utils";
import { minutesToTime, normalizeTime, timeToMinutes } from "./scheduleWeek";

export interface ScheduleConflict {
  message: string;
  conflictTime: string;
}

export interface ScheduleConflictParams {
  date: string;
  timeStart: string;
  timeEnd: string;
  locationId: string | null;
  excludeLessonId?: string;
  excludeSlotId?: string;
}

export interface PersonalLessonRef {
  id: string;
  date: string;
  timeStart: string;
  timeEnd: string;
  locationId?: string | null;
}

export interface ScheduleSlotRef {
  id?: string;
  dayOfWeek: number;
  time: string;
  timeEnd: string;
  locationId?: string | null;
  validFrom?: string;
  validTo?: string | null;
}

function locationsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? null) === (b ?? null);
}

function timesOverlapMinutes(start1: string, end1: string, start2: string, end2: string): boolean {
  return timeToMinutes(start1) < timeToMinutes(end2) && timeToMinutes(start2) < timeToMinutes(end1);
}

function overlapStartTime(start1: string, end1: string, start2: string, end2: string): string {
  const overlapMin = Math.max(timeToMinutes(start1), timeToMinutes(start2));
  return minutesToTime(overlapMin);
}

function slotValidOnDate(validFrom: string, validTo: string | null | undefined, date: string): boolean {
  if (validFrom > date) return false;
  if (validTo != null && validTo < date) return false;
  return true;
}

function conflictText(key: I18nKey, translate?: TranslateFn, locale?: string | null): string {
  if (translate) return translate(key);
  return t(locale, key);
}

/** Conflict check for a concrete date + location; compares times in minutes (HH:MM). */
export function findScheduleConflict(
  params: ScheduleConflictParams,
  personalLessons: PersonalLessonRef[],
  scheduleSlots: ScheduleSlotRef[],
  translate?: TranslateFn,
  locale?: string | null
): ScheduleConflict | null {
  const { date, timeStart, timeEnd, locationId, excludeLessonId, excludeSlotId } = params;

  let timeStartNorm: string;
  let timeEndNorm: string;
  try {
    timeStartNorm = normalizeTime(timeStart);
    timeEndNorm = normalizeTime(timeEnd);
  } catch {
    return {
      message: conflictText("utils.conflict.invalidTime", translate, locale),
      conflictTime: timeStart,
    };
  }

  for (const lesson of personalLessons) {
    if (excludeLessonId && lesson.id === excludeLessonId) continue;
    if (!locationsMatch(lesson.locationId, locationId)) continue;
    if (lesson.date !== date) continue;
    const lessonEnd = lesson.timeEnd || lesson.timeStart;
    if (timesOverlapMinutes(timeStartNorm, timeEndNorm, lesson.timeStart, lessonEnd)) {
      return {
        message: conflictText("utils.conflict.personalLesson", translate, locale),
        conflictTime: overlapStartTime(timeStartNorm, timeEndNorm, lesson.timeStart, lessonEnd),
      };
    }
  }

  const dow = jsDayToIsoDow(new Date(`${date}T12:00:00`).getDay());

  for (const slot of scheduleSlots) {
    if (excludeSlotId && slot.id === excludeSlotId) continue;
    if (!locationsMatch(slot.locationId, locationId)) continue;
    if (slot.dayOfWeek !== dow) continue;

    const validFrom = slot.validFrom ?? "2000-01-01";
    if (!slotValidOnDate(validFrom, slot.validTo, date)) continue;

    const slotEnd = slot.timeEnd || "21:00";
    if (timesOverlapMinutes(timeStartNorm, timeEndNorm, slot.time, slotEnd)) {
      return {
        message: conflictText("utils.conflict.groupLesson", translate, locale),
        conflictTime: overlapStartTime(timeStartNorm, timeEndNorm, slot.time, slotEnd),
      };
    }
  }

  return null;
}

export function formatScheduleConflictToast(
  isoDate: string,
  conflict: ScheduleConflict,
  translate?: TranslateFn,
  locale?: string | null
): string {
  const dateLabel = formatDateLocale(isoDate, locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  if (translate) {
    return translate("utils.conflict.toast", {
      date: dateLabel,
      time: conflict.conflictTime,
      reason: conflict.message,
    });
  }
  return t(locale, "utils.conflict.toast", {
    date: dateLabel,
    time: conflict.conflictTime,
    reason: conflict.message,
  });
}

export { findBookingScheduleConflict } from "./utils";
