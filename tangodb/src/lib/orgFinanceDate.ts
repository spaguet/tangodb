/** Org-local calendar date (YYYY-MM-DD) in the organization timezone. */
export function orgLocalDateString(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone?.trim() || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

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

/** Shift a YYYY-MM-DD calendar date without using the browser timezone. */
export function addOrgCalendarDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + days));
  const yy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(utc.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export type CreatedAtUtcRange = {
  gte?: string;
  lt?: string;
};

function dayStartUtcMs(date: string, timezone: string): number {
  return orgLocalDateTimeToUtcMs(date, "00:00", timezone);
}

function dayStartUtcIso(date: string, timezone: string): string {
  return new Date(dayStartUtcMs(date, timezone)).toISOString();
}

/** Inclusive calendar-day range in org TZ → UTC ISO bounds (`gte` / exclusive `lt`). */
export function orgCreatedAtUtcRange(
  filter: { dateFrom?: string; dateTo?: string; todayOnly?: boolean },
  timezone: string,
  now = new Date()
): CreatedAtUtcRange {
  if (filter.todayOnly) {
    const day = orgLocalDateString(timezone, now);
    return {
      gte: dayStartUtcIso(day, timezone),
      lt: dayStartUtcIso(addOrgCalendarDays(day, 1), timezone),
    };
  }

  const range: CreatedAtUtcRange = {};
  if (filter.dateFrom) range.gte = dayStartUtcIso(filter.dateFrom, timezone);
  if (filter.dateTo) {
    range.lt = dayStartUtcIso(addOrgCalendarDays(filter.dateTo, 1), timezone);
  }
  return range;
}

export function applyCreatedAtUtcRange<
  T extends {
    gte: (column: string, value: string) => T;
    lt: (column: string, value: string) => T;
  },
>(query: T, range: CreatedAtUtcRange): T {
  let next = query;
  if (range.gte) next = next.gte("created_at", range.gte);
  if (range.lt) next = next.lt("created_at", range.lt);
  return next;
}

export function isInstantInOrgDay(
  createdAt: string | undefined,
  day: string,
  timezone: string
): boolean {
  return isInstantInOrgInclusiveDates(createdAt, day, day, timezone);
}

export function isInstantInOrgInclusiveDates(
  createdAt: string | undefined,
  dateFrom: string,
  dateTo: string,
  timezone: string
): boolean {
  if (!createdAt) return false;
  const ms = Date.parse(createdAt);
  if (Number.isNaN(ms)) return false;
  const start = dayStartUtcMs(dateFrom, timezone);
  const end = dayStartUtcMs(addOrgCalendarDays(dateTo, 1), timezone);
  return ms >= start && ms < end;
}

/** inclusive closed-until day: operation on or before is in a closed period */
export function isFinancePeriodClosed(
  operationDate: string,
  closedUntil: string | null | undefined
): boolean {
  if (!closedUntil || !operationDate) return false;
  return operationDate <= closedUntil;
}

/** First calendar day allowed for a new operation after closed period. */
export function minOpenOperationDate(closedUntil: string | null | undefined): string | undefined {
  if (!closedUntil) return undefined;
  const [y, m, d] = closedUntil.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  const next = new Date(y, m - 1, d + 1);
  const yy = next.getFullYear();
  const mm = String(next.getMonth() + 1).padStart(2, "0");
  const dd = String(next.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
