import { useCallback } from "react";
import { useOrganization } from "../organization/OrganizationProvider";
import {
  t,
  getGuestLocale,
  pluralize,
  formatDateLocale,
  formatDateTimeLocale,
  type I18nKey,
  type TranslateParams,
} from "../lib/i18n";

export function useI18n() {
  const { settings } = useOrganization();
  const locale = settings?.locale ?? getGuestLocale();

  const translate = useCallback(
    (key: I18nKey, params?: TranslateParams) => t(locale, key, params),
    [locale]
  );

  const plural = useCallback(
    (count: number, forms: [string, string, string]) => pluralize(locale, count, forms),
    [locale]
  );

  const formatDate = useCallback(
    (iso: string | Date, options?: Intl.DateTimeFormatOptions) => formatDateLocale(iso, locale, options),
    [locale]
  );

  const formatDateTime = useCallback(
    (iso: string | Date, options?: Intl.DateTimeFormatOptions) => formatDateTimeLocale(iso, locale, options),
    [locale]
  );

  return {
    locale,
    t: translate,
    plural,
    formatDate,
    formatDateTime,
  };
}

/** For auth pages and other contexts outside org settings */
export function useGuestI18n() {
  const locale = getGuestLocale();

  const translate = useCallback(
    (key: I18nKey, params?: TranslateParams) => t(locale, key, params),
    [locale]
  );

  return { locale, t: translate };
}
