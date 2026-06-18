import { useOrganization } from "../organization/OrganizationProvider";
import { t, type I18nKey } from "../lib/i18n";

export function useI18n() {
  const { settings } = useOrganization();
  const locale = settings?.locale ?? "ru-RU";

  return {
    locale,
    t: (key: I18nKey) => t(locale, key),
  };
}
