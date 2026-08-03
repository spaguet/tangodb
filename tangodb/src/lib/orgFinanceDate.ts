/** Org-local calendar date (YYYY-MM-DD) in the organization timezone. */
export function orgLocalDateString(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone?.trim() || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
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
