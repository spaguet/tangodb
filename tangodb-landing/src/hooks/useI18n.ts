import { useEffect, useState } from "react";
import { OG_IMAGE_PATH, SITE_URL } from "../config";
import type { I18nKey, Locale } from "../i18n";
import { detectLocale, en, persistLocale, ru } from "../i18n";
import { syncPageMeta } from "../lib/pageMeta";

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
    syncPageMeta({
      title: dict["meta.title"],
      description: dict["meta.description"],
      imageUrl: `${SITE_URL}${OG_IMAGE_PATH}`,
      pageUrl: `${SITE_URL}/`,
    });
  }, [locale, dict]);

  return { locale, t, setLocale };
}
