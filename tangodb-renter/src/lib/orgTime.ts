const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: string): boolean {
  return ISO_DATE_RE.test(value.trim());
}

function partValue(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((part) => part.type === type)?.value ?? "";
}

/** Calendar date YYYY-MM-DD in organization timezone (formatToParts: iOS ignores en-CA). */
export function orgLocalDate(timezone: string, at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const y = partValue(parts, "year");
  const m = partValue(parts, "month");
  const d = partValue(parts, "day");
  return `${y}-${m}-${d}`;
}

/**
 * ISO weekday 1=Mon … 7=Sun for a calendar YYYY-MM-DD.
 * Uses UTC Y-M-D arithmetic — iOS Intl weekday names are not stable (Mon. / пн / Thu.).
 */
export function orgIsoWeekday(_timezone: string, isoDate: string): number {
  const noon = dateAtUtcNoon(isoDate);
  const dow = noon.getUTCDay();
  return dow === 0 ? 7 : dow;
}

function dateAtUtcNoon(isoDate: string): Date {
  const match = ISO_DATE_RE.exec(isoDate.trim().slice(0, 10));
  if (!match) return new Date(NaN);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

/** Human date for Mini App selects: «03 июля 2026» / «03 July 2026». */
export function formatLongDate(isoDate: string, locale: string): string {
  const noon = dateAtUtcNoon(isoDate);
  if (Number.isNaN(noon.getTime())) return isoDate;
  const loc = locale.toLowerCase().startsWith("en") ? "en-GB" : "ru-RU";
  const parts = new Intl.DateTimeFormat(loc, {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).formatToParts(noon);
  const day = partValue(parts, "day").padStart(2, "0");
  const month = partValue(parts, "month");
  const year = partValue(parts, "year");
  if (!day || !month || !year) return isoDate;
  return `${day} ${month} ${year}`;
}

/**
 * iOS WKWebView may return option text («03 июля 2026») instead of value (YYYY-MM-DD).
 * Prefer an ISO match, then the selected index into `days`.
 */
export function resolveIsoDateFromSelect(
  raw: string,
  days: string[],
  selectedIndex: number
): string {
  const trimmed = raw.trim();
  if (isIsoDate(trimmed) && (days.length === 0 || days.includes(trimmed))) return trimmed;
  const sliced = trimmed.slice(0, 10);
  if (isIsoDate(sliced) && (days.length === 0 || days.includes(sliced))) return sliced;
  if (selectedIndex >= 0 && selectedIndex < days.length) return days[selectedIndex];
  return days[0] ?? (isIsoDate(sliced) ? sliced : trimmed);
}

export function addCalendarDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** 3 calendar weeks Mon–Sun aligned with server `_renter_occupancy_window`. */
export function occupancyWindowDays(timezone: string): {
  start: string;
  end: string;
  days: string[];
} {
  const today = orgLocalDate(timezone);
  const weekday = orgIsoWeekday(timezone, today);
  const monday = addCalendarDays(today, -(weekday - 1));
  const end = addCalendarDays(monday, 20);
  const days: string[] = [];
  for (let i = 0; i < 21; i++) {
    days.push(addCalendarDays(monday, i));
  }
  return { start: monday, end, days };
}

export function occupancyDaysFromWindow(windowFrom: string, count = 21): string[] {
  const days: string[] = [];
  for (let i = 0; i < count; i++) {
    days.push(addCalendarDays(windowFrom, i));
  }
  return days;
}

/** Split the occupancy window into Mon–Sun weeks (ISO, 7 days each). */
export function occupancyWeeksFromWindow(windowFrom: string, count = 21): string[][] {
  const days = occupancyDaysFromWindow(windowFrom, count);
  const weeks: string[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }
  return weeks;
}

export function calendarDayNumber(isoDate: string): number {
  return Number(isoDate.slice(8, 10));
}

export function formatShortDate(isoDate: string, locale: string): string {
  const noon = dateAtUtcNoon(isoDate);
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(noon);
}

/** Week range for a Mon–Sun pair of calendar dates (org TZ, not browser local). */
export function formatWeekRangeLabel(
  fromIso: string,
  toIso: string,
  locale: string,
  withYear = true
): string {
  const start = dateAtUtcNoon(fromIso);
  const end = dateAtUtcNoon(toIso);
  const loc = locale.startsWith("en") ? "en-US" : "ru-RU";
  const startDay = start.getUTCDate();
  const endDay = end.getUTCDate();
  const year = end.getUTCFullYear();
  const monthFmt = new Intl.DateTimeFormat(loc, { month: "short", timeZone: "UTC" });
  const startMonth = monthFmt.format(start);
  const endMonth = monthFmt.format(end);
  const sameMonth =
    start.getUTCMonth() === end.getUTCMonth() && start.getUTCFullYear() === end.getUTCFullYear();
  if (sameMonth) {
    if (loc === "ru-RU") return withYear ? `${startDay}–${endDay} ${startMonth} ${year}` : `${startDay}–${endDay} ${startMonth}`;
    return withYear ? `${startMonth} ${startDay}–${endDay}, ${year}` : `${startMonth} ${startDay}–${endDay}`;
  }
  if (loc === "ru-RU") {
    return withYear
      ? `${startDay} ${startMonth} – ${endDay} ${endMonth} ${year}`
      : `${startDay} ${startMonth} – ${endDay} ${endMonth}`;
  }
  return withYear
    ? `${startMonth} ${startDay} – ${endMonth} ${endDay}, ${year}`
    : `${startMonth} ${startDay} – ${endMonth} ${endDay}`;
}

export function formatTimeRange(start: string, end: string): string {
  return `${start.slice(0, 5)}–${end.slice(0, 5)}`;
}

const ONE_HOUR_MINUTES = 60;

/** Org-local clock minutes (0–1439) at a server-aligned instant. */
export function orgLocalTimeMinutes(timezone: string, atMs: number): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(atMs));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

/** Client-side mirror of server tooSoon: free cells within 1 h or in the past are not bookable. */
export function isFreeSlotBookable(
  timezone: string,
  date: string,
  slotStart: string,
  serverNowMs: number
): boolean {
  const today = orgLocalDate(timezone, new Date(serverNowMs));
  if (date < today) return false;
  if (date > today) return true;
  const slotMin = Number(slotStart.slice(0, 2)) * 60 + Number(slotStart.slice(3, 5));
  return slotMin >= orgLocalTimeMinutes(timezone, serverNowMs) + ONE_HOUR_MINUTES;
}

function wallClockAsUtcMs(timezone: string, instantMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instantMs));
  const n = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const hour = n("hour") === 24 ? 0 : n("hour");
  return Date.UTC(n("year"), n("month") - 1, n("day"), hour, n("minute"), n("second"));
}

/** UTC ms of calendar `YYYY-MM-DD` + `HH:MM` in the organization timezone. */
export function orgZonedDateTimeMs(timezone: string, isoDate: string, timeHhMm: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  const [hh, mm] = timeHhMm.slice(0, 5).split(":").map(Number);
  const desiredAsUtc = Date.UTC(y, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0);
  let utc = desiredAsUtc;
  for (let i = 0; i < 3; i++) {
    utc += desiredAsUtc - wallClockAsUtcMs(timezone, utc);
  }
  return utc;
}
