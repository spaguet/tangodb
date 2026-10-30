/**
 * Wall clock in IANA timezone → UTC Date (for local notification schedule).
 */
export function wallClockInTimeZoneToDate(
  dateStr: string,
  timeStr: string,
  timeZone: string
): Date | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  const timeMatch = /^(\d{1,2}):(\d{2})/.exec(timeStr);
  if (!dateMatch || !timeMatch) return null;

  const y = Number(dateMatch[1]);
  const mo = Number(dateMatch[2]);
  const d = Number(dateMatch[3]);
  const hh = Number(timeMatch[1]);
  const mm = Number(timeMatch[2]);

  let utcGuess = Date.UTC(y, mo - 1, d, hh, mm, 0);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  for (let i = 0; i < 3; i++) {
    const parts = fmt.formatToParts(new Date(utcGuess));
    const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
    const fy = pick("year");
    const fmo = pick("month");
    const fd = pick("day");
    const fh = pick("hour");
    const fmin = pick("minute");
    const displayedAsUtc = Date.UTC(fy, fmo - 1, fd, fh === 24 ? 0 : fh, fmin, 0);
    const desiredAsUtc = Date.UTC(y, mo - 1, d, hh, mm, 0);
    const diffMs = desiredAsUtc - displayedAsUtc;
    if (Math.abs(diffMs) < 1000) break;
    utcGuess += diffMs;
  }

  return new Date(utcGuess);
}

export function stableNotificationId(parts: string[]): number {
  const text = parts.join("|");
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return (Math.abs(hash) % 2147480000) + 1;
}
