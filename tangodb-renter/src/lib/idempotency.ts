const PREFIX = "renter_idem_";

export function getOrCreateIdempotencyKey(scope: string): string {
  const key = PREFIX + scope;
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const fresh = crypto.randomUUID();
  sessionStorage.setItem(key, fresh);
  return fresh;
}

export function clearIdempotencyKey(scope: string): void {
  sessionStorage.removeItem(PREFIX + scope);
}

export function bookingScope(
  organizationId: string,
  locationId: string,
  rentalDate: string,
  timeStart: string,
  timeEnd: string
): string {
  return `${organizationId}:${locationId}:${rentalDate}:${timeStart}:${timeEnd}`;
}

export function packScope(
  organizationId: string,
  locationId: string,
  validFrom: string,
  validTo: string,
  timeStart: string,
  timeEnd: string,
  weekdays: number[]
): string {
  return `${organizationId}:${locationId}:${validFrom}:${validTo}:${timeStart}:${timeEnd}:${[...weekdays].sort((a, b) => a - b).join(",")}`;
}
