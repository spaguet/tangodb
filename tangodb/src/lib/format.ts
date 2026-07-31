import { getCurrencySymbolHint, getCurrencySymbolOverride } from "./currencies";
import { resolveLocale } from "./i18n";
import type { OrganizationSettings } from "../types/organization";

export interface FormatOptions {
  locale: string;
  currencyCode: string;
  currencyDisplay: "symbol" | "code";
}

export const DEFAULT_FORMAT_OPTIONS: FormatOptions = {
  locale: "ru-RU",
  currencyCode: "RUB",
  currencyDisplay: "symbol",
};

export function formatOptionsFromSettings(
  settings: Pick<OrganizationSettings, "locale" | "currency_code" | "currency_display"> | null | undefined
): FormatOptions {
  if (!settings) return DEFAULT_FORMAT_OPTIONS;
  return {
    locale: settings.locale ? resolveLocale(settings.locale) : DEFAULT_FORMAT_OPTIONS.locale,
    currencyCode: settings.currency_code || DEFAULT_FORMAT_OPTIONS.currencyCode,
    currencyDisplay: settings.currency_display ?? DEFAULT_FORMAT_OPTIONS.currencyDisplay,
  };
}

export function formatCurrency(amount: number, options: FormatOptions = DEFAULT_FORMAT_OPTIONS): string {
  const value = Number(amount);
  const safeAmount = Number.isFinite(value) ? value : 0;
  const locale = options.locale ? resolveLocale(options.locale) : DEFAULT_FORMAT_OPTIONS.locale;
  const currencyCode = options.currencyCode || DEFAULT_FORMAT_OPTIONS.currencyCode;
  const currencyDisplay = options.currencyDisplay ?? DEFAULT_FORMAT_OPTIONS.currencyDisplay;

  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currencyCode,
    currencyDisplay: currencyDisplay === "symbol" ? "narrowSymbol" : "code",
    maximumFractionDigits: 0,
  });

  const symbolOverride = currencyDisplay === "symbol" ? getCurrencySymbolOverride(currencyCode) : null;
  return formatter
    .formatToParts(safeAmount)
    .map((part) => {
      if (part.type === "group") return " ";
      if (part.type === "currency" && symbolOverride) return symbolOverride;
      if (part.type === "literal") return part.value.replace(/[\u00A0\u202F]/g, " ");
      return part.value;
    })
    .join("");
}

let activeFormatOptions: FormatOptions = DEFAULT_FORMAT_OPTIONS;

/** Called by SettingsProvider so legacy formatCurrency() imports use org settings. */
export function setActiveFormatOptions(options: FormatOptions): void {
  activeFormatOptions = options;
}

export function getActiveFormatOptions(): FormatOptions {
  return activeFormatOptions;
}

export function formatCurrencyActive(amount: number): string {
  return formatCurrency(amount, activeFormatOptions);
}

/** Symbol or ISO code shown beside numeric price inputs. */
export function getCurrencyInputSuffix(options: FormatOptions): string {
  if (options.currencyDisplay === "code") return options.currencyCode;
  return getCurrencySymbolHint(options.currencyCode);
}
