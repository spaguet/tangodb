import { useMemo } from "react";
import { useOrganization } from "../organization/OrganizationProvider";
import { useOrgEdition } from "./useOrgEdition";
import { renewalPurchasePath } from "../lib/orgEdition";
import {
  getCrmSubscriptionGraceDaysLeft,
  isCrmSubscriptionTMinus7,
  isCrmSubscriptionWriteClosed,
} from "../lib/crmSubscriptionState";

const PURCHASE_ROLES = new Set(["owner", "director"]);

export function useCrmSubscriptionUi() {
  const { organization, role, license, subscription } = useOrganization();
  const { edition } = useOrgEdition();

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
    const monthPastDue =
      subscription?.status === "past_due" ||
      edition?.liveMonthPhase === "past_due" ||
      edition?.liveMonthPhase === "canceled";
    const graceDaysLeft =
      writeClosed || monthPastDue ? getCrmSubscriptionGraceDaysLeft(periodEnd) : null;
    const showGraceBanner =
      canPurchase &&
      organization?.status === "licensed" &&
      monthPastDue &&
      (graceDaysLeft === null || graceDaysLeft >= 0);

    return {
      canPurchase,
      periodEnd,
      writeClosed,
      tMinus7,
      showTMinus7Banner: canPurchase && tMinus7 && organization?.status === "licensed",
      showGraceBanner,
      graceDaysLeft,
      purchasePath: renewalPurchasePath(edition),
    };
  }, [organization, role, license, subscription, edition]);
}
