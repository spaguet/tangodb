/** Curated ISO-4217 codes for CRM org settings (§8.6). Crypto is payment-only, not here. */
export const CURATED_CURRENCY_CODES = [
  "RUB",
  "USD",
  "EUR",
  "GBP",
  "CNY",
  "JPY",
  "KRW",
  "TRY",
  "KZT",
  "AED",
  "THB",
  "VND",
  "IDR",
  "INR",
  "BRL",
  "MXN",
  "CAD",
  "AUD",
  "CHF",
  "SGD",
] as const;

export type CuratedCurrencyCode = (typeof CURATED_CURRENCY_CODES)[number];

export const DEFAULT_CURRENCY_CODE: CuratedCurrencyCode = "RUB";

const CURATED_SET = new Set<string>(CURATED_CURRENCY_CODES);

/** Intl may emit the code instead of a glyph — normalize for select labels and formatting. */
export const CURRENCY_SYMBOL_OVERRIDES: Partial<Record<CuratedCurrencyCode, string>> = {
  KZT: "₸",
  AED: "د.إ",
  VND: "₫",
};

function intlSymbolHint(code: CuratedCurrencyCode): string {
  try {
    const parts = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: 0,
    }).formatToParts(0);
    const part = parts.find((p) => p.type === "currency")?.value?.trim();
    if (part && part !== code) return part;
  } catch {
    /* unsupported in runtime — fall through */
  }
  return CURRENCY_SYMBOL_OVERRIDES[code] ?? code;
}

export function getCurrencySymbolHint(code: string): string {
  if (isCuratedCurrencyCode(code) && CURRENCY_SYMBOL_OVERRIDES[code]) {
    return CURRENCY_SYMBOL_OVERRIDES[code]!;
  }
  if (isCuratedCurrencyCode(code)) return intlSymbolHint(code);
  return code;
}

export function isCuratedCurrencyCode(code: string): code is CuratedCurrencyCode {
  return CURATED_SET.has(code.toUpperCase());
}

export interface CurrencySelectOption {
  value: CuratedCurrencyCode;
  label: string;
}

export const CURRENCY_SELECT_OPTIONS: CurrencySelectOption[] = CURATED_CURRENCY_CODES.map((code) => ({
  value: code,
  label: `${code} — ${getCurrencySymbolHint(code)}`,
}));

export function getCurrencySymbolOverride(code: string): string | null {
  if (!isCuratedCurrencyCode(code)) return null;
  const override = CURRENCY_SYMBOL_OVERRIDES[code];
  if (override) return override;

  try {
    const parts = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: 0,
    }).formatToParts(0);
    const part = parts.find((p) => p.type === "currency")?.value?.trim();
    if (part && part !== code) return part;
  } catch {
    return null;
  }
  return null;
}
