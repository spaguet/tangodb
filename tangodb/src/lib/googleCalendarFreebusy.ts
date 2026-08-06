export type GoogleFreebusyInterval = {
  start: string;
  end: string;
};

/** Convert org-local date + HH:MM to UTC epoch ms using IANA timezone. */
export function orgLocalDateTimeToUtcMs(
  date: string,
  time: string,
  timeZone: string
): number {
  const tz = timeZone?.trim() || "UTC";
  const hm = time.length >= 5 ? time.slice(0, 5) : time;
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = hm.split(":").map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts = formatter.formatToParts(new Date(utcGuess));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  );

  return utcGuess - (asUtc - utcGuess);
}

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
