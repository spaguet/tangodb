/** Quote TTL and purge window rules for create-purchase-quote (S2b). */

export const QUOTE_TTL_MS = 24 * 60 * 60 * 1000;
export const PURGE_QUOTE_MIN_WINDOW_MS = 15 * 60 * 1000;

export function computeQuoteExpiresAt(nowMs: number, dataPurgeAtIso: string | null): string {
  const capMs = nowMs + QUOTE_TTL_MS;
  if (!dataPurgeAtIso) {
    return new Date(capMs).toISOString();
  }
  const purgeMs = Date.parse(dataPurgeAtIso);
  if (Number.isNaN(purgeMs)) {
    return new Date(capMs).toISOString();
  }
  return new Date(Math.min(capMs, purgeMs)).toISOString();
}

export function assertQuoteCreationAllowed(
  nowMs: number,
  dataPurgeAtIso: string | null
): { ok: true } | { ok: false; code: string } {
  if (!dataPurgeAtIso) {
    return { ok: true };
  }
  const purgeMs = Date.parse(dataPurgeAtIso);
  if (Number.isNaN(purgeMs)) {
    return { ok: true };
  }
  if (nowMs >= purgeMs) {
    return { ok: false, code: "demo_purge_deadline_passed" };
  }
  if (purgeMs - nowMs < PURGE_QUOTE_MIN_WINDOW_MS) {
    return { ok: false, code: "purge_window_too_short" };
  }
  return { ok: true };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

export type PurchaseQuoteSku = "crm_license" | "crm_subscription";

export function parsePurchaseQuoteSku(raw: string): PurchaseQuoteSku | null {
  const sku = raw.trim();
  if (sku === "crm_license" || sku === "crm_subscription") return sku;
  return null;
}
