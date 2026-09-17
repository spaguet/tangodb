import { useMemo } from "react";
import { clientPhonePlaceholder } from "../lib/clientDisplay";
import { useI18n } from "./useI18n";
import { useOrganization } from "../organization/OrganizationProvider";

export function useClientFieldPlaceholders() {
  const { t } = useI18n();
  const { settings } = useOrganization();

  return useMemo(
    () => ({
      firstName: t("clients.placeholder.firstName"),
      lastName: t("clients.placeholder.lastName"),
      email: t("clients.placeholder.email"),
      phone: clientPhonePlaceholder(settings?.currency_code),
    }),
    [t, settings?.currency_code]
  );
}
