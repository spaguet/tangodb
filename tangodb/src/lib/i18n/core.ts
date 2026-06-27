import type { I18nKey } from "./keys";
import { EN } from "./en";
import { RU } from "./ru";
import { VI } from "./vi";

export type LocaleCode = "ru-RU" | "en-US" | "vi-VN";

const GUEST_LOCALE_KEY = "tangodb-locale-pref";

const DICTS: Record<LocaleCode, Partial<Record<I18nKey, string>>> = {
  "ru-RU": RU,
  "en-US": EN,
  "vi-VN": VI,
};

export function resolveLocale(locale?: string | null): LocaleCode {
  if (!locale) return "ru-RU";
  if (locale.startsWith("en")) return "en-US";
  if (locale.startsWith("vi")) return "vi-VN";
  return "ru-RU";
}

export function getGuestLocale(): LocaleCode {
  try {
    const stored = localStorage.getItem(GUEST_LOCALE_KEY);
    if (stored) return resolveLocale(stored);
  } catch {
    /* ignore */
  }
  return "ru-RU";
}

export const GUEST_LOCALE_CHANGED = "tangodb-guest-locale-changed";

export function setGuestLocale(locale: string): void {
  try {
    localStorage.setItem(GUEST_LOCALE_KEY, locale);
    window.dispatchEvent(new CustomEvent(GUEST_LOCALE_CHANGED, { detail: locale }));
  } catch {
    /* ignore */
  }
}

export type TranslateParams = Record<string, string | number>;

export function t(
  locale: string | null | undefined,
  key: I18nKey,
  params?: TranslateParams
): string {
  const code = resolveLocale(locale);
  let text = DICTS[code][key] ?? DICTS["ru-RU"][key] ?? DICTS["en-US"][key] ?? key;

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), String(v));
    }
  }

  return text;
}

/** Russian-style pluralization; en-US uses one/other via count === 1 check */
export function pluralize(
  locale: string | null | undefined,
  count: number,
  forms: [string, string, string]
): string {
  const code = resolveLocale(locale);
  if (code === "en-US") {
    return count === 1 ? forms[0] : forms[2];
  }
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
}

export function formatDateLocale(
  iso: string | Date,
  locale: string | null | undefined,
  options?: Intl.DateTimeFormatOptions
): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  return date.toLocaleDateString(resolveLocale(locale), options);
}

export function formatDateTimeLocale(
  iso: string | Date,
  locale: string | null | undefined,
  options?: Intl.DateTimeFormatOptions
): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  return date.toLocaleString(resolveLocale(locale), options);
}
