export const CRM_SUBSCRIPTION_GRACE_DAYS = 7;
export const CRM_SUBSCRIPTION_TMINUS7_DAYS = 7;

export function parseSubscriptionTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** UI/SQL write gate for a CRM SaaS month. Independent of cron past_due. Not for suspended redirect. */
export function isCrmSubscriptionWriteClosed(input: {
  licenseType?: string | null;
  subscriptionStatus?: string | null;
  currentPeriodEnd?: string | null;
  now?: Date;
}): boolean {
  if (input.licenseType !== "subscription") return false;
  if (input.subscriptionStatus !== "active") return true;
  const periodEnd = parseSubscriptionTimestamp(input.currentPeriodEnd);
  if (!periodEnd) return true;
  return periodEnd.getTime() <= (input.now ?? new Date()).getTime();
}

export function isCrmSubscriptionTMinus7(input: {
  licenseType?: string | null;
  subscriptionStatus?: string | null;
  currentPeriodEnd?: string | null;
  now?: Date;
}): boolean {
  if (input.licenseType !== "subscription") return false;
  if (input.subscriptionStatus !== "active") return false;
  const periodEnd = parseSubscriptionTimestamp(input.currentPeriodEnd);
  if (!periodEnd) return false;
  const now = input.now ?? new Date();
  if (periodEnd.getTime() <= now.getTime()) return false;
  return periodEnd.getTime() <= now.getTime() + CRM_SUBSCRIPTION_TMINUS7_DAYS * 86_400_000;
}

export function getCrmSubscriptionGraceEnd(periodEnd: string | null | undefined): Date | null {
  const end = parseSubscriptionTimestamp(periodEnd);
  if (!end) return null;
  return new Date(end.getTime() + CRM_SUBSCRIPTION_GRACE_DAYS * 86_400_000);
}

export function getCrmSubscriptionGraceDaysLeft(
  periodEnd: string | null | undefined,
  now = new Date()
): number | null {
  const graceEnd = getCrmSubscriptionGraceEnd(periodEnd);
  if (!graceEnd) return null;
  const ms = graceEnd.getTime() - now.getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / 86_400_000);
}
