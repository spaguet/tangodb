import type { I18nKey } from "./i18n/keys";
import { t } from "./i18n";
import type { OrgStatus } from "../types/organization";

const ORG_STATUS_KEYS: Partial<Record<OrgStatus, I18nKey>> = {
  demo_active: "license.status.demoActive",
  demo_retention: "license.status.demoRetention",
  licensed: "license.status.licensed",
  suspended: "license.status.suspended",
  purged: "license.status.purged",
};

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Public studio name — same rule as CRM header (branding_name, then org name). */
export function organizationPublicName(
  org: { name: string; slug?: string | null } | null | undefined,
  brandingName?: string | null
): string {
  const branding = brandingName?.trim();
  if (branding) return branding;
  const name = org?.name?.trim() ?? "";
  if (name && !looksLikeEmail(name)) return name;
  const slug = org?.slug?.trim();
  if (slug) return slug;
  return name;
}

export function organizationStatusLabel(
  status: OrgStatus | string | null | undefined,
  locale?: string | null
): string {
  if (!status) return "";
  const key = ORG_STATUS_KEYS[status as OrgStatus];
  return key ? t(locale, key) : String(status).replace(/_/g, " ");
}
