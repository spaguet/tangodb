import type { Locale } from "../i18n";

export function demoToday(): Date {
  return new Date();
}

export function startOfMonth(date: Date): Date {
  const d = new Date(date);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addMonths(date: Date, delta: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + delta);
  return d;
}

export function getMondayOfWeek(ref: Date = demoToday()): Date {
  const d = new Date(ref);
  d.setHours(0, 0, 0, 0);
  const weekday = d.getDay();
  const diff = weekday === 0 ? -6 : 1 - weekday;
  d.setDate(d.getDate() + diff);
  return d;
}

export function formatMonthYear(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
    month: "long",
    year: "numeric",
  }).format(date);
}

/** Month header in dashboard finance block (RU adds «г.»). */
export function formatDemoMonthHeader(date: Date, locale: Locale): string {
  const label = formatMonthYear(date, locale);
  return locale === "ru" ? `${label} г.` : label;
}

export function formatWeekRangeLabel(locale: Locale, ref: Date = demoToday()): string {
  const start = getMondayOfWeek(ref);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);

  if (locale === "ru") {
    const sameMonth = start.getMonth() === end.getMonth();
    const monthFmt = new Intl.DateTimeFormat("ru-RU", { month: "long" });
    const year = start.getFullYear();
    if (sameMonth) {
      return `${start.getDate()}–${end.getDate()} ${monthFmt.format(start)} ${year}`;
    }
    return `${start.getDate()} ${monthFmt.format(start)} – ${end.getDate()} ${monthFmt.format(end)} ${year}`;
  }

  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const y = start.getFullYear();
  if (start.getMonth() === end.getMonth()) {
    return `${start.toLocaleDateString("en-US", opts)}–${end.getDate()}, ${y}`;
  }
  return `${start.toLocaleDateString("en-US", opts)} – ${end.toLocaleDateString("en-US", opts)}, ${y}`;
}

export function formatLessonDateTime(
  locale: Locale,
  date: Date,
  time: string,
  discipline: string,
): string {
  if (locale === "ru") {
    const dayMonth = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(date);
    const weekday = new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(date);
    return `${dayMonth} (${weekday}) · ${time} — ${discipline}`;
  }
  const datePart = date.toLocaleDateString("en-US", { month: "short", day: "numeric", weekday: "short" });
  return `${datePart} · ${time} — ${discipline}`;
}

/** Sample group lesson in the current week (Wednesday if possible). */
export function demoAttendanceLessonDate(): Date {
  const monday = getMondayOfWeek();
  const d = new Date(monday);
  d.setDate(monday.getDate() + 2);
  return d;
}
