import type { OrgStatus } from "../types/organization";
import { formatDateLocale, pluralize, t } from "./i18n";

export const DEMO_PURCHASE_PATH = "/settings/license?purchase=1";

export type DemoUrgencyTone = "default" | "warning" | "critical";

export function isDemoOrgStatus(status: OrgStatus | null | undefined): boolean {
  return status === "demo_active" || status === "demo_retention";
}

export function getDemoDaysLeft(demoExpiresAt: string | null | undefined): number | null {
  if (!demoExpiresAt) return null;
  const expires = new Date(demoExpiresAt);
  if (Number.isNaN(expires.getTime())) return null;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfExpiry = new Date(expires.getFullYear(), expires.getMonth(), expires.getDate());
  return Math.ceil((startOfExpiry.getTime() - startOfToday.getTime()) / 86400000);
}

export function getDemoUrgencyTone(
  daysLeft: number | null,
  status: OrgStatus | null | undefined
): DemoUrgencyTone {
  if (status === "demo_retention") return "critical";
  if (daysLeft == null) return "default";
  if (daysLeft <= 3) return "critical";
  if (daysLeft <= 7) return "warning";
  return "default";
}

export function formatDemoExpiryDate(
  iso: string | null | undefined,
  locale?: string | null
): string {
  if (!iso) return "—";
  return formatDateLocale(iso, locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function formatDemoDaysLeftLabel(
  daysLeft: number | null,
  status: OrgStatus | null | undefined,
  locale?: string | null
): string | null {
  if (status === "demo_retention") return t(locale, "demo.daysLeft.viewOnly");
  if (daysLeft == null) return null;
  if (daysLeft <= 0) return t(locale, "demo.daysLeft.expired");
  const forms: [string, string, string] = [
    t(locale, "demo.daysLeft.remainingOne", { count: daysLeft }),
    t(locale, "demo.daysLeft.remainingFew", { count: daysLeft }),
    t(locale, "demo.daysLeft.remainingMany", { count: daysLeft }),
  ];
  return pluralize(locale, daysLeft, forms);
}

export const DEMO_URGENCY_TEXT_CLASS: Record<DemoUrgencyTone, string> = {
  default: "text-gold-700",
  warning: "text-amber-700",
  critical: "text-garnet-600",
};
