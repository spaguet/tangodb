export type Locale = "en" | "ru";

export type I18nKey = keyof typeof import("./en").en;

const STORAGE_KEY = "tangodb-landing-locale";

export function detectLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "en" || stored === "ru") return stored;
  const lang = navigator.language.toLowerCase();
  return lang.startsWith("ru") ? "ru" : "en";
}

export function persistLocale(locale: Locale) {
  localStorage.setItem(STORAGE_KEY, locale);
}

export { en } from "./en";
export { ru } from "./ru";
