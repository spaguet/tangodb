import { useEffect, useState } from "react";
import { SITE_URL, PRIVACY_PATH, OG_IMAGE_PATH } from "../config";
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
    const normalizedPath = window.location.pathname.replace(/\/$/, "") || "/";
    const isPrivacyPage = normalizedPath === PRIVACY_PATH;

    document.documentElement.lang = locale;
    syncPageMeta({
      title: isPrivacyPage ? dict["privacy.metaTitle"] : dict["meta.title"],
      description: isPrivacyPage ? dict["privacy.metaDescription"] : dict["meta.description"],
      imageUrl: `${SITE_URL}${OG_IMAGE_PATH}`,
      pageUrl: isPrivacyPage ? `${SITE_URL}${PRIVACY_PATH}` : `${SITE_URL}/`,
      locale,
    });
  }, [locale, dict]);

  return { locale, t, setLocale };
}
