import { useMemo } from "react";
import { useOrganization } from "../organization/OrganizationProvider";
import {
  LICENSE_PURCHASE_PATH,
  purchaseCtaKind,
  purchaseCtaPath,
  purchaseSkuLock,
} from "../lib/crmLicensePurchase";
import { useDemoLicenseUi } from "./useDemoLicenseUi";

export function useCrmLicensePurchaseUi() {
  const { organization, role, license, subscription } = useOrganization();
  const demo = useDemoLicenseUi();

  return useMemo(() => {
    const canPurchaseRole = role === "owner" || role === "director";
    const licenseType = license?.license_type ?? null;
    const subscriptionStatus = subscription?.status ?? null;
    const orgStatus = organization?.status ?? null;
    const kind = canPurchaseRole
      ? purchaseCtaKind({
          orgStatus,
          licenseType,
          subscriptionStatus,
          currentPeriodEnd: subscription?.current_period_end,
          dataPurgeAt: organization?.data_purge_at,
        })
      : null;

    return {
      ...demo,
      showPurchaseCta: kind !== null,
      purchasePath: kind ? purchaseCtaPath(kind) : LICENSE_PURCHASE_PATH,
      ctaKind: kind,
      skuLock: purchaseSkuLock({ orgStatus, licenseType, subscriptionStatus }),
    };
  }, [demo, organization, role, license, subscription]);
}
