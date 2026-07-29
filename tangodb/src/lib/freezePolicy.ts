import type { OrganizationSettings } from "../types/organization";
import type { BillingModel } from "../types";

export interface FreezePolicy {
  freezeEnabled: boolean;
  freezeMaxCount: number;
  freezeMinLessons: number;
}

export const DEFAULT_FREEZE_POLICY: FreezePolicy = {
  freezeEnabled: true,
  freezeMaxCount: 1,
  freezeMinLessons: 8,
};

export function freezePolicyFromSettings(
  settings: Pick<
    OrganizationSettings,
    "freeze_enabled" | "freeze_max_count" | "freeze_min_lessons"
  > | null | undefined
): FreezePolicy {
  if (!settings) return DEFAULT_FREEZE_POLICY;
  return {
    freezeEnabled: settings.freeze_enabled,
    freezeMaxCount: settings.freeze_max_count,
    freezeMinLessons: settings.freeze_min_lessons,
  };
}

export function subscriptionMeetsFreezeMinLessons(
  lessonsTotal: number,
  policy: FreezePolicy = DEFAULT_FREEZE_POLICY,
  billingModel: BillingModel = "lesson_count"
): boolean {
  if (billingModel === "monthly_unlimited") return true;
  return lessonsTotal >= policy.freezeMinLessons;
}

export function canApplyFreeze(
  lessonsTotal: number,
  freezeUsed: number,
  policy: FreezePolicy = DEFAULT_FREEZE_POLICY,
  billingModel: BillingModel = "lesson_count"
): boolean {
  if (!policy.freezeEnabled) return false;
  return (
    subscriptionMeetsFreezeMinLessons(lessonsTotal, policy, billingModel) &&
    freezeUsed < policy.freezeMaxCount
  );
}

export function wouldExceedFreezeLimit(
  freezeUsed: number,
  freezeDelta: number,
  policy: FreezePolicy = DEFAULT_FREEZE_POLICY
): boolean {
  return freezeUsed + freezeDelta > policy.freezeMaxCount;
}

export function freezeUnavailableMessage(policy: FreezePolicy = DEFAULT_FREEZE_POLICY): string {
  return `Заморозка доступна только для абонементов от ${policy.freezeMinLessons} уроков (макс. ${policy.freezeMaxCount}).`;
}

export function freezeAlreadyUsedMessage(policy: FreezePolicy = DEFAULT_FREEZE_POLICY): string {
  return `Лимит заморозок (${policy.freezeMaxCount}) по этому абонементу исчерпан.`;
}

export function resolveFreezePolicyForSubscription(
  orgPolicy: FreezePolicy,
  price?: { freezeMaxCount?: number | null; freezeMinLessons?: number | null } | null
): FreezePolicy {
  if (price?.freezeMaxCount == null && price?.freezeMinLessons == null) return orgPolicy;
  return {
    ...orgPolicy,
    freezeMaxCount: price.freezeMaxCount ?? orgPolicy.freezeMaxCount,
    freezeMinLessons: price.freezeMinLessons ?? orgPolicy.freezeMinLessons,
  };
}

export function inclusiveCalendarDays(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((end.getTime() - start.getTime()) / msPerDay) + 1;
}
