/** Mirrors SQL `_renter_topup_amount_max` / `_renter_currency_minor`. */
const ZERO_DECIMAL_CURRENCIES = new Set(["JPY", "KRW", "VND"]);

export function topupAmountMax(currencyCode: string): number {
  const code = currencyCode.trim().toUpperCase();
  return ZERO_DECIMAL_CURRENCIES.has(code) ? 100_000_000 : 1_000_000;
}

export function resolveTopupAmountMax(
  currencyCode: string,
  bootstrapMax?: number | null
): number {
  if (bootstrapMax != null && Number.isFinite(bootstrapMax) && bootstrapMax > 0) {
    return bootstrapMax;
  }
  return topupAmountMax(currencyCode);
}
