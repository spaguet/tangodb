/** Contact fields that must not land in IndexedDB (S35 / M12). */
const CONTACT_KEY_RE =
  /^(phone|telegram|email|contact_email|contactemail|guardian\d*(_)?(phone|telegram|email|address))$/i;

function stripValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripValue);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (CONTACT_KEY_RE.test(key)) continue;
    out[key] = stripValue(nested);
  }
  return out;
}

/** Drop phone / telegram / email (and guardian contacts) from a snapshot or queue blob. */
export function stripOfflineContactPii<T>(value: T): T {
  return stripValue(value) as T;
}
