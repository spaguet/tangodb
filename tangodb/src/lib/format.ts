import { getCurrencySymbolOverride } from "./currencies";
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
    locale: settings.locale,
    currencyCode: settings.currency_code,
    currencyDisplay: settings.currency_display,
  };
}

export function formatCurrency(amount: number, options: FormatOptions = DEFAULT_FORMAT_OPTIONS): string {
  const { locale, currencyCode, currencyDisplay } = options;

  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currencyCode,
    currencyDisplay: currencyDisplay === "symbol" ? "narrowSymbol" : "code",
    maximumFractionDigits: 0,
  });

  if (currencyDisplay === "symbol") {
    const symbolOverride = getCurrencySymbolOverride(currencyCode);
    if (symbolOverride) {
      return formatter
        .formatToParts(amount)
        .map((part) => (part.type === "currency" ? symbolOverride : part.value))
        .join("");
    }
  }

  return formatter.format(amount);
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
