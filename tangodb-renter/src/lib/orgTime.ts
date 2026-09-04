/** Calendar date YYYY-MM-DD in organization timezone. */
export function orgLocalDate(timezone: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** ISO weekday 1=Mon … 7=Sun for a calendar date in org TZ. */
export function orgIsoWeekday(timezone: string, isoDate: string): number {
  const noon = dateAtUtcNoon(isoDate);
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
  }).format(noon);
  const map: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  return map[wd] ?? 1;
}

function dateAtUtcNoon(isoDate: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0));
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
