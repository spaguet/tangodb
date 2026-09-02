/** Venue-rule payment gate: a rule valid through valid_to still covers that day. */
export function isVenuePaymentAckRequired(
  acknowledgementRequired: boolean,
  latestValidTo: string | null | undefined,
  serviceDate?: string | null
): boolean {
  if (!acknowledgementRequired) return false;
  const day = serviceDate?.slice(0, 10) ?? "";
  if (!day) return true;
  const validTo = latestValidTo?.slice(0, 10) ?? "";
  if (validTo && day <= validTo) return false;
  return true;
}
