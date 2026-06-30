import { useEffect, useState } from "react";
import type { I18nKey, Locale } from "../i18n";
import { detectLocale, en, persistLocale, ru } from "../i18n";

export function useI18n() {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);

  const dict = locale === "ru" ? ru : en;

  const t = (key: I18nKey) => dict[key];

  const setLocale = (next: Locale) => {
    persistLocale(next);
    setLocaleState(next);
  };

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = dict["meta.title"];
  }, [locale, dict]);

  return { locale, t, setLocale };
}
