import { useMemo } from "react";
import { useOrganization } from "../organization/OrganizationProvider";
import { MONTHLY_PURCHASE_PATH } from "../lib/crmLicensePurchase";
import {
  getCrmSubscriptionGraceDaysLeft,
  isCrmSubscriptionTMinus7,
  isCrmSubscriptionWriteClosed,
} from "../lib/crmSubscriptionState";

const PURCHASE_ROLES = new Set(["owner", "director"]);

export function useCrmSubscriptionUi() {
  const { organization, role, license, subscription } = useOrganization();

  return useMemo(() => {
    const canPurchase = !!role && PURCHASE_ROLES.has(role);
    const periodEnd = subscription?.current_period_end ?? null;
    const writeClosed = isCrmSubscriptionWriteClosed({
      licenseType: license?.license_type,
      subscriptionStatus: subscription?.status,
      currentPeriodEnd: periodEnd,
    });
    const tMinus7 = isCrmSubscriptionTMinus7({
      licenseType: license?.license_type,
      subscriptionStatus: subscription?.status,
      currentPeriodEnd: periodEnd,
    });

    return {
      canPurchase,
      periodEnd,
      writeClosed,
      tMinus7,
      showTMinus7Banner: canPurchase && tMinus7 && organization?.status === "licensed",
      graceDaysLeft: writeClosed ? getCrmSubscriptionGraceDaysLeft(periodEnd) : null,
      purchasePath: MONTHLY_PURCHASE_PATH,
    };
  }, [organization, role, license, subscription]);
}
