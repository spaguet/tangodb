const PREFIX = "renter_idem_";
const memoryKeys = new Map<string, string>();

function randomUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function getOrCreateIdempotencyKey(scope: string): string {
  const key = PREFIX + scope;
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const fresh = randomUuid();
    sessionStorage.setItem(key, fresh);
    memoryKeys.set(key, fresh);
    return fresh;
  } catch {
    const existing = memoryKeys.get(key);
    if (existing) return existing;
    const fresh = randomUuid();
    memoryKeys.set(key, fresh);
    return fresh;
  }
}

export function clearIdempotencyKey(scope: string): void {
  memoryKeys.delete(PREFIX + scope);
  try {
    sessionStorage.removeItem(PREFIX + scope);
  } catch {
    /* iOS WKWebView may block sessionStorage */
  }
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
