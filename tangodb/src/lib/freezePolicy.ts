import type { OrganizationSettings } from "../types/organization";

export interface FreezePolicy {
  freezeMaxCount: number;
  freezeMinLessons: number;
  freezeDeductsLesson: boolean;
}

export const DEFAULT_FREEZE_POLICY: FreezePolicy = {
  freezeMaxCount: 1,
  freezeMinLessons: 8,
  freezeDeductsLesson: true,
};

export function freezePolicyFromSettings(
  settings: Pick<
    OrganizationSettings,
    "freeze_max_count" | "freeze_min_lessons" | "freeze_deducts_lesson"
  > | null | undefined
): FreezePolicy {
  if (!settings) return DEFAULT_FREEZE_POLICY;
  return {
    freezeMaxCount: settings.freeze_max_count,
    freezeMinLessons: settings.freeze_min_lessons,
    freezeDeductsLesson: settings.freeze_deducts_lesson,
  };
}

export function subscriptionMeetsFreezeMinLessons(
  lessonsTotal: number,
  policy: FreezePolicy = DEFAULT_FREEZE_POLICY
): boolean {
  return lessonsTotal >= policy.freezeMinLessons;
}

export function canApplyFreeze(
  lessonsTotal: number,
  freezeUsed: number,
  policy: FreezePolicy = DEFAULT_FREEZE_POLICY
): boolean {
  return subscriptionMeetsFreezeMinLessons(lessonsTotal, policy) && freezeUsed < policy.freezeMaxCount;
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
