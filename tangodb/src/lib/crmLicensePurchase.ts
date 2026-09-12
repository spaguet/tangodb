import type { LicenseType, OrgStatus, SubscriptionStatus } from "../types/organization";
import { isDemoOrgStatus } from "./demoLicense";
import type { PlatformPaymentSku } from "./paymentConfig";

export const LICENSE_PURCHASE_PATH = "/settings/license?purchase=1";
export const MONTHLY_PURCHASE_PATH = "/settings/license?purchase=1&plan=monthly";
export const LIFETIME_PURCHASE_PATH = "/settings/license?purchase=1&plan=lifetime";

export type PurchasePlanPrefill = "monthly" | "lifetime" | null;
export type PurchaseSkuLock = "choice" | "monthly";
export type PurchaseCtaKind = "buy" | "renew";

export function parsePurchasePlanParam(raw: string | null | undefined): PurchasePlanPrefill {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "monthly") return "monthly";
  if (value === "lifetime") return "lifetime";
  return null;
}

export function prefillSkuFromPlan(plan: PurchasePlanPrefill): PlatformPaymentSku | "" {
  if (plan === "monthly") return "crm_subscription";
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
  return isCrmMonthlyEntitlement(input.licenseType, input.subscriptionStatus);
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
}): PurchaseSkuLock {
  if (input.orgStatus === "suspended") return "choice";
  if (isCrmMonthlyEntitlement(input.licenseType, input.subscriptionStatus)) return "monthly";
  return "choice";
}

export function resolveSelectedSku(
  lock: PurchaseSkuLock,
  prefill: PurchasePlanPrefill,
  userSku: PlatformPaymentSku | ""
): PlatformPaymentSku | "" {
  if (lock === "monthly") return "crm_subscription";
  if (userSku) return userSku;
  return prefillSkuFromPlan(prefill);
}

/** Nav/header CTA: demo buy, past_due/suspended renew. Monthly active has in-page button only. */
export function purchaseCtaKind(input: {
  orgStatus: OrgStatus | string | null | undefined;
  licenseType: LicenseType | string | null | undefined;
  subscriptionStatus?: SubscriptionStatus | string | null;
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
  if (input.subscriptionStatus === "past_due") return "renew";
  return null;
}

export function purchaseCtaPath(kind: PurchaseCtaKind): string {
  return kind === "renew" ? MONTHLY_PURCHASE_PATH : LICENSE_PURCHASE_PATH;
}
