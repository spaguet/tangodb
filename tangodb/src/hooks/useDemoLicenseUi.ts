import { useMemo } from "react";
import { useOrganization } from "../organization/OrganizationProvider";
import {
  DEMO_PURCHASE_PATH,
  formatDemoDaysLeftLabel,
  formatDemoExpiryDate,
  getDemoDaysLeft,
  getDemoUrgencyTone,
  isDemoOrgStatus,
} from "../lib/demoLicense";

const DEMO_PURCHASE_ROLES = new Set(["owner", "director"]);

export function useDemoLicenseUi() {
  const { organization, role } = useOrganization();

  return useMemo(() => {
    const status = organization?.status ?? null;
    const isDemo = isDemoOrgStatus(status);
    const daysLeft = isDemo ? getDemoDaysLeft(organization?.demo_expires_at) : null;
    const urgency = getDemoUrgencyTone(daysLeft, status);
    const expiryDate = formatDemoExpiryDate(organization?.demo_expires_at);
    const purgeDate = formatDemoExpiryDate(organization?.data_purge_at);
    const daysLeftLabel = formatDemoDaysLeftLabel(daysLeft, status);
    const showPurchaseCta = isDemo && !!role && DEMO_PURCHASE_ROLES.has(role);

    return {
      isDemo,
      showPurchaseCta,
      status,
      daysLeft,
      daysLeftLabel,
      expiryDate,
      purgeDate,
      urgency,
      purchasePath: DEMO_PURCHASE_PATH,
    };
  }, [organization, role]);
}
