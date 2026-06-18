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
  const formatted = new Intl.NumberFormat(options.locale, {
    style: "currency",
    currency: options.currencyCode,
    currencyDisplay: options.currencyDisplay,
    maximumFractionDigits: 0,
  }).format(amount);

  if (options.currencyCode === "VND" && options.currencyDisplay === "symbol") {
    return formatted.replace("VND", "₫");
  }

  return formatted;
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
