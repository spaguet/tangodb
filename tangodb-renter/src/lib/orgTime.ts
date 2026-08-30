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

export function formatShortDate(isoDate: string, locale: string): string {
  const noon = dateAtUtcNoon(isoDate);
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(noon);
}

export function formatTimeRange(start: string, end: string): string {
  return `${start.slice(0, 5)}–${end.slice(0, 5)}`;
}
