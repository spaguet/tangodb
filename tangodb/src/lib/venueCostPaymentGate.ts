/** Last covered day after valid_to (matches SQL grace: end of month after valid_to's month). */
export function venueRuleCoverageEndDate(validTo: string): string | null {
  const iso = validTo.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const end = new Date(year, month + 1, 0);
  const y = end.getFullYear();
  const m = String(end.getMonth() + 1).padStart(2, "0");
  const d = String(end.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Venue-rule payment gate: lesson date within valid_to or grace period does not need ack. */
export function isVenuePaymentAckRequired(
  acknowledgementRequired: boolean,
  latestValidTo: string | null | undefined,
  serviceDate?: string | null
): boolean {
  if (!acknowledgementRequired) return false;
  const day = serviceDate?.slice(0, 10) ?? "";
  if (!day) return true;
  const validTo = latestValidTo?.slice(0, 10) ?? "";
  if (!validTo) return true;
  if (day <= validTo) return false;
  const coverageEnd = venueRuleCoverageEndDate(validTo);
  if (coverageEnd && day <= coverageEnd) return false;
  return true;
}
