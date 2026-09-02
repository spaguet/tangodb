import { jsDayToIsoDow } from "./utils";
import { t, formatDateLocale } from "./i18n";
import type { I18nKey } from "./i18n/keys";
import type { TranslateFn } from "./utils";
import { minutesToTime, normalizeTime, timeToMinutes } from "./scheduleWeek";

export interface ScheduleConflict {
  message: string;
  conflictTime: string;
  otherTimeStart?: string;
  otherTimeEnd?: string;
  otherLabel?: string;
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
  clientDisplay?: string;
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

function conflictTextWithParams(
  key: I18nKey,
  params: Record<string, string | number>,
  translate?: TranslateFn,
  locale?: string | null
): string {
  if (translate) return translate(key, params);
  return t(locale, key, params);
}

function personalConflictLabel(display?: string | null): string | undefined {
  const label = display?.trim();
  if (!label || label === "schedule.lessonInfo.clientNotSpecified") return undefined;
  return label;
}

export function isExactPersonalSlotMatch(
  slot: { date: string; timeStart: string; timeEnd: string; locationId: string | null },
  lesson: PersonalLessonRef
): boolean {
  try {
    return (
      lesson.date === slot.date &&
      locationsMatch(lesson.locationId, slot.locationId) &&
      normalizeTime(lesson.timeStart) === normalizeTime(slot.timeStart) &&
      normalizeTime(lesson.timeEnd || lesson.timeStart) === normalizeTime(slot.timeEnd)
    );
  } catch {
    return false;
  }
}

/** Dates that already have a personal lesson at the same location and time (not a conflict to re-create). */
export function filterNewPersonalSeriesSlots<T extends { date: string; timeStart: string; timeEnd: string }>(
  slots: T[],
  params: { locationId: string | null; excludeLessonId?: string },
  personalLessons: PersonalLessonRef[]
): T[] {
  return slots.filter((slot) => {
    const exists = personalLessons.some((lesson) => {
      if (params.excludeLessonId && lesson.id === params.excludeLessonId) return false;
      return isExactPersonalSlotMatch({ ...slot, locationId: params.locationId }, lesson);
    });
    return !exists;
  });
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
      const otherLabel = personalConflictLabel(lesson.clientDisplay);
      return {
        message: otherLabel
          ? conflictTextWithParams(
              "utils.conflict.personalLessonNamed",
              { name: otherLabel },
              translate,
              locale
            )
          : conflictText("utils.conflict.personalLesson", translate, locale),
        conflictTime: overlapStartTime(timeStartNorm, timeEndNorm, lesson.timeStart, lessonEnd),
        otherTimeStart: lesson.timeStart,
        otherTimeEnd: lessonEnd,
        otherLabel,
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
        otherTimeStart: slot.time,
        otherTimeEnd: slotEnd,
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
  const timeLabel =
    conflict.otherTimeStart && conflict.otherTimeEnd
      ? `${conflict.otherTimeStart}–${conflict.otherTimeEnd}`
      : conflict.conflictTime;
  const params = {
    date: dateLabel,
    time: timeLabel,
    reason: conflict.message,
  };
  if (translate) {
    return translate("utils.conflict.toast", params);
  }
  return t(locale, "utils.conflict.toast", params);
}

export { findBookingScheduleConflict } from "./utils";
