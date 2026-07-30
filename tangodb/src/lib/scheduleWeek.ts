import { jsDayToIsoDow } from "./utils";
import { resolveLocale } from "./i18n";
import type { GroupDisplayLesson, ScheduleSlot } from "../types";

/** Local calendar date as YYYY-MM-DD (school TZ = browser local). */
export function toISODateLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Monday 00:00 … Sunday 00:00 of the week containing `anchor`. */
export function getWeekRange(anchor: Date): { weekStart: Date; weekEnd: Date } {
  const d = new Date(anchor);
  d.setHours(0, 0, 0, 0);
  const isoDow = jsDayToIsoDow(d.getDay());
  const weekStart = new Date(d);
  weekStart.setDate(d.getDate() - (isoDow - 1));
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  return { weekStart, weekEnd };
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + days);
  return toISODateLocal(d);
}

/** First calendar date >= fromDate when this ISO day-of-week occurs (school local TZ). */
export function nextOccurrenceOnOrAfter(fromDate: string, dayOfWeek: number): string {
  const fromDow = jsDayToIsoDow(new Date(`${fromDate}T12:00:00`).getDay());
  const delta = (dayOfWeek - fromDow + 7) % 7;
  return addDays(fromDate, delta);
}

export function normalizeTime(hhmm: string): string {
  const [rawH, rawM = "0"] = hhmm.split(":");
  const h = Number(rawH);
  const m = Number(rawM);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    throw new Error(`Invalid HH:MM time: ${hhmm}`);
  }
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function timeToMinutes(hhmm: string): number {
  const [h, m] = normalizeTime(hhmm).split(":").map(Number);
  return h * 60 + m;
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function slotValidForWeek(
  slot: ScheduleSlot,
  weekStartISO: string,
  weekEndISO: string
): boolean {
  if (slot.validFrom > weekEndISO) return false;
  if (slot.validTo != null && slot.validTo < weekStartISO) return false;
  return true;
}

/** Expand weekly template slots into concrete dates inside [weekStart, weekEnd]. */
export function expandSlotsToWeek(
  slots: ScheduleSlot[],
  weekStart: Date,
  weekEnd: Date
): GroupDisplayLesson[] {
  const weekStartISO = toISODateLocal(weekStart);
  const weekEndISO = toISODateLocal(weekEnd);
  const result: GroupDisplayLesson[] = [];

  for (const slot of slots) {
    if (!slot.id || !slotValidForWeek(slot, weekStartISO, weekEndISO)) continue;

    for (let offset = 0; offset < 7; offset += 1) {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + offset);
      if (date > weekEnd) break;

      const isoDow = jsDayToIsoDow(date.getDay());
      if (isoDow !== slot.dayOfWeek) continue;

      const dateISO = toISODateLocal(date);
      if (dateISO < slot.validFrom) continue;
      if (slot.validTo != null && dateISO > slot.validTo) continue;

      result.push({
        kind: "group",
        slotId: slot.id,
        date: dateISO,
        timeStart: normalizeTime(slot.time),
        timeEnd: normalizeTime(slot.timeEnd),
        validFrom: slot.validFrom,
        validTo: slot.validTo,
        dayOfWeek: slot.dayOfWeek,
        disciplineId: slot.disciplineId ?? null,
        groupName: slot.groupName,
        scheduleGroupId: slot.scheduleGroupId ?? null,
        locationId: slot.locationId ?? null,
        teacherMemberId: slot.teacherMemberId ?? null,
        movedFromSlotId: slot.movedFromSlotId ?? null,
        movedFromDate: slot.movedFromDate ?? null,
        movedFromTime: slot.movedFromTime ?? null,
      });
    }
  }

  return result.sort(
    (a, b) => a.date.localeCompare(b.date) || timeToMinutes(a.timeStart) - timeToMinutes(b.timeStart)
  );
}

export function formatWeekRangeLabel(weekStart: Date, weekEnd: Date, locale?: string | null): string {
  const code = resolveLocale(locale);
  const startDay = weekStart.getDate();
  const endDay = weekEnd.getDate();
  const year = weekEnd.getFullYear();
  const startMonth = weekStart.toLocaleDateString(code, { month: "long" });
  const endMonth = weekEnd.toLocaleDateString(code, { month: "long" });

  if (weekStart.getMonth() === weekEnd.getMonth()) {
    if (code === "ru-RU") {
      return `${startDay}–${endDay} ${startMonth} ${year}`;
    }
    return `${startMonth} ${startDay}–${endDay}, ${year}`;
  }
  if (code === "ru-RU") {
    return `${startDay} ${startMonth} – ${endDay} ${endMonth} ${year}`;
  }
  return `${startMonth} ${startDay} – ${endMonth} ${endDay}, ${year}`;
}

export function isPastDate(dateISO: string): boolean {
  return dateISO < toISODateLocal(new Date());
}

/** Schedule write lock for past dates; bypass when member has can_edit_past_schedule. */
export function isScheduleDateLockedForWrite(
  dateISO: string,
  canEditPastSchedule = false
): boolean {
  if (canEditPastSchedule) return false;
  return isPastDate(dateISO);
}

/** Personal lessons: edit/delete blocked only for past dates (today and future allowed). */
export function isPersonalLessonLockedForWrite(
  dateISO: string,
  canEditPastSchedule = false
): boolean {
  return isScheduleDateLockedForWrite(dateISO, canEditPastSchedule);
}

export function computeDisplayRange(
  lessons: Array<{ timeStart: string; timeEnd: string }>
): { start: number; end: number } {
  const DEFAULT_START = 7 * 60;
  const DEFAULT_END = 22 * 60;
  if (lessons.length === 0) return { start: DEFAULT_START, end: DEFAULT_END };

  const minStart = Math.min(...lessons.map((s) => timeToMinutes(s.timeStart)));
  const maxEnd = Math.max(...lessons.map((s) => timeToMinutes(s.timeEnd)));
  return {
    start: Math.min(minStart, DEFAULT_START),
    end: Math.max(maxEnd, DEFAULT_END),
  };
}
