import type { LicenseType, OrgStatus, SubscriptionStatus } from "../types/organization";
import { isDemoOrgStatus } from "./demoLicense";
import type { PlatformPaymentSku } from "./paymentConfig";
import { isCrmSubscriptionTMinus7, isCrmSubscriptionWriteClosed } from "./crmSubscriptionState";
import type { OrgEditionSnapshot } from "./orgEdition";
import { purchaseSkuLockForEdition } from "./orgEdition";
import { hasLiveProLifetime } from "./licenseEditionUi";

export const LICENSE_PURCHASE_PATH = "/settings/license?purchase=1";
export const MONTHLY_PURCHASE_PATH = "/settings/license?purchase=1&plan=monthly";
export const STUDIO_PURCHASE_PATH = "/settings/license?purchase=1&plan=studio";
export const LIFETIME_PURCHASE_PATH = "/settings/license?purchase=1&plan=lifetime";

export type PurchasePlanPrefill = "monthly" | "lifetime" | "studio" | null;
export type PurchaseSkuLock = "choice" | "studio_month" | "pro_month";
/** @deprecated Use `pro_month` in product code; kept for 2.11 tests. */
export type LegacyPurchaseSkuLock = PurchaseSkuLock | "monthly";
export type PurchaseCtaKind = "buy" | "renew";

export function parsePurchasePlanParam(raw: string | null | undefined): PurchasePlanPrefill {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "monthly") return "monthly";
  if (value === "lifetime") return "lifetime";
  if (value === "studio") return "studio";
  return null;
}

export function prefillSkuFromPlan(plan: PurchasePlanPrefill): PlatformPaymentSku | "" {
  if (plan === "monthly") return "crm_subscription";
  if (plan === "studio") return "crm_studio_subscription";
  if (plan === "lifetime") return "crm_license";
  return "";
}

export function isPurgeDeadlinePassed(
  dataPurgeAt: string | null | undefined,
  now = new Date()
): boolean {
  if (!dataPurgeAt) return false;
  const purge = new Date(dataPurgeAt);
  if (Number.isNaN(purge.getTime())) return false;
  return now.getTime() >= purge.getTime();
}

export function isCrmLifetimeLicense(
  licenseType: LicenseType | string | null | undefined
): boolean {
  return licenseType === "lifetime";
}

export function isCrmMonthlyEntitlement(
  licenseType: LicenseType | string | null | undefined,
  subscriptionStatus: SubscriptionStatus | string | null | undefined
): boolean {
  if (licenseType !== "subscription") return false;
  return subscriptionStatus === "active" || subscriptionStatus === "past_due";
}

/** Demo until purge, monthly active/past_due, suspended recovery — never lifetime. */
export function isManualPurchaseEligible(input: {
  orgStatus: OrgStatus | string | null | undefined;
  licenseType: LicenseType | string | null | undefined;
  subscriptionStatus?: SubscriptionStatus | string | null;
  dataPurgeAt?: string | null;
  now?: Date;
}): boolean {
  if (isCrmLifetimeLicense(input.licenseType)) return false;
  const now = input.now ?? new Date();
  if (isDemoOrgStatus(input.orgStatus as OrgStatus)) {
    return !isPurgeDeadlinePassed(input.dataPurgeAt, now);
  }
  if (input.orgStatus === "suspended") return true;
  if (isCrmMonthlyEntitlement(input.licenseType, input.subscriptionStatus)) return true;
  if (input.orgStatus === "licensed" && !isCrmLifetimeLicense(input.licenseType)) return true;
  return false;
}

export function canShowManualPurchasePanel(input: {
  isPurchaseFlow: boolean;
  orgStatus: OrgStatus | string | null | undefined;
  licenseType: LicenseType | string | null | undefined;
  subscriptionStatus?: SubscriptionStatus | string | null;
  dataPurgeAt?: string | null;
  now?: Date;
}): boolean {
  return input.isPurchaseFlow && isManualPurchaseEligible(input);
}

export function purchaseSkuLock(input: {
  orgStatus: OrgStatus | string | null | undefined;
  licenseType: LicenseType | string | null | undefined;
  subscriptionStatus?: SubscriptionStatus | string | null;
  edition?: OrgEditionSnapshot | null;
}): PurchaseSkuLock {
  if (input.orgStatus === "suspended") return "choice";
  const fromEdition = purchaseSkuLockForEdition(input.edition ?? null);
  if (fromEdition !== null) return fromEdition;
  if (isCrmMonthlyEntitlement(input.licenseType, input.subscriptionStatus)) return "pro_month";
  return "choice";
}

/** Ignores ?plan=studio when Pro month lock is active (F72). */
export function effectivePurchasePlanPrefill(
  lock: PurchaseSkuLock,
  rawPlan: PurchasePlanPrefill
): PurchasePlanPrefill {
  if (lock === "pro_month" && rawPlan === "studio") return null;
  return rawPlan;
}

export function shouldHidePaidPurchaseSkus(input: {
  licenseType: LicenseType | string | null | undefined;
  edition?: OrgEditionSnapshot | null;
}): boolean {
  if (isCrmLifetimeLicense(input.licenseType)) return true;
  if (hasLiveProLifetime(input.edition ?? null)) return true;
  return false;
}

export function resolveSelectedSku(
  lock: PurchaseSkuLock | "monthly",
  prefill: PurchasePlanPrefill,
  userSku: PlatformPaymentSku | ""
): PlatformPaymentSku | "" {
  if (lock === "pro_month" || lock === "monthly") {
    if (userSku === "crm_license") return "crm_license";
    const fromPrefill = prefillSkuFromPlan(prefill);
    if (fromPrefill === "crm_license") return "crm_license";
    return "crm_subscription";
  }
  if (lock === "studio_month") {
    if (userSku === "crm_subscription" || userSku === "crm_license") return userSku;
    const fromPrefill = prefillSkuFromPlan(prefill);
    if (fromPrefill === "crm_subscription" || fromPrefill === "crm_license") return fromPrefill;
    return "crm_studio_subscription";
  }
  if (userSku) return userSku;
  return prefillSkuFromPlan(prefill);
}

/** Nav/header CTA: demo buy; T−7 / past_due / expired month / suspended renew. */
export function purchaseCtaKind(input: {
  orgStatus: OrgStatus | string | null | undefined;
  licenseType: LicenseType | string | null | undefined;
  subscriptionStatus?: SubscriptionStatus | string | null;
  currentPeriodEnd?: string | null;
  dataPurgeAt?: string | null;
  now?: Date;
}): PurchaseCtaKind | null {
  if (isCrmLifetimeLicense(input.licenseType)) return null;
  const now = input.now ?? new Date();
  if (isDemoOrgStatus(input.orgStatus as OrgStatus)) {
    if (isPurgeDeadlinePassed(input.dataPurgeAt, now)) return null;
    return "buy";
  }
  if (input.orgStatus === "suspended") return "renew";
  if (
    isCrmSubscriptionWriteClosed({
      licenseType: input.licenseType,
      subscriptionStatus: input.subscriptionStatus,
      currentPeriodEnd: input.currentPeriodEnd,
      now,
    })
  ) {
    return "renew";
  }
  if (
    isCrmSubscriptionTMinus7({
      licenseType: input.licenseType,
      subscriptionStatus: input.subscriptionStatus,
      currentPeriodEnd: input.currentPeriodEnd,
      now,
    })
  ) {
    return "renew";
  }
  return null;
}

export function purchaseCtaPath(kind: PurchaseCtaKind): string {
  return kind === "renew" ? MONTHLY_PURCHASE_PATH : LICENSE_PURCHASE_PATH;
}
