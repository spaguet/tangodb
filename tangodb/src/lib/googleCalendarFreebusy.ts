import { orgLocalDateTimeToUtcMs } from "./orgFinanceDate";

export type GoogleFreebusyInterval = {
  start: string;
  end: string;
};

export { orgLocalDateTimeToUtcMs };

export function lessonOverlapsBusyIntervals(
  date: string,
  timeStart: string,
  timeEnd: string,
  timeZone: string,
  busy: GoogleFreebusyInterval[]
): boolean {
  if (!busy.length) return false;

  const lessonStart = orgLocalDateTimeToUtcMs(date, timeStart, timeZone);
  const lessonEnd = orgLocalDateTimeToUtcMs(date, timeEnd, timeZone);
  if (lessonEnd <= lessonStart) return false;

  for (const slot of busy) {
    const busyStart = Date.parse(slot.start);
    const busyEnd = Date.parse(slot.end);
    if (Number.isNaN(busyStart) || Number.isNaN(busyEnd)) continue;
    if (lessonStart < busyEnd && lessonEnd > busyStart) {
      return true;
    }
  }

  return false;
}

export const GOOGLE_FREEBUSY_SCOPE = "https://www.googleapis.com/auth/calendar.freebusy";
export const GOOGLE_EVENTS_FREEBUSY_SCOPE =
  "https://www.googleapis.com/auth/calendar.events.freebusy";

export function resolveFreebusyConsentPurpose(calendarIds: string[]): string {
  if (calendarIds.length === 0) return "freebusy";
  if (calendarIds.length === 1) return "freebusy_single";
  return "freebusy_multi";
}

export function accountHasFreebusyScopes(
  grantedScopes: string[] | null | undefined,
  calendarIds: string[]
): boolean {
  if (!calendarIds.length) return false;
  const scopes = new Set(grantedScopes ?? []);
  if (calendarIds.length === 1) {
    return scopes.has(GOOGLE_FREEBUSY_SCOPE) || scopes.has(GOOGLE_EVENTS_FREEBUSY_SCOPE);
  }
  return scopes.has(GOOGLE_EVENTS_FREEBUSY_SCOPE);
}
