import type { OrgStatus } from "../types/organization";
import { pluralizeRu } from "./utils";

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

export function formatDemoExpiryDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function formatDemoDaysLeftLabel(daysLeft: number | null, status: OrgStatus | null | undefined): string | null {
  if (status === "demo_retention") return "только просмотр";
  if (daysLeft == null) return null;
  if (daysLeft <= 0) return "срок истёк";
  return `${daysLeft} ${pluralizeRu(daysLeft, ["день", "дня", "дней"])} осталось`;
}

export const DEMO_URGENCY_TEXT_CLASS: Record<DemoUrgencyTone, string> = {
  default: "text-indigo-600",
  warning: "text-amber-600",
  critical: "text-rose-600",
};
