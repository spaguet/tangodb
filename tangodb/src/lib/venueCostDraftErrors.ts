import type { I18nKey } from "./i18n/keys";
import type { TranslateFn } from "./utils";

export interface VenueCostDraftErrorParsed {
  code: string;
  params?: Record<string, string>;
}

const ERROR_KEY_MAP: Record<string, I18nKey> = {
  valid_from_required: "venueCosts.error.validFromRequired",
  invalid_date_range: "venueCosts.error.invalidDateRange",
  valid_to_required: "venueCosts.error.validToRequired",
  invalid_period: "venueCosts.error.invalidPeriod",
  fixed_location_required: "venueCosts.error.fixedLocationRequired",
  invalid_amount: "venueCosts.error.invalidAmount",
  lesson_types_required: "venueCosts.error.lessonTypesRequired",
  teacher_required: "venueCosts.error.teacherRequired",
  invalid_personal_amount: "venueCosts.error.invalidPersonalAmount",
  group_tiers_required: "venueCosts.error.groupTiersRequired",
  invalid_group_tiers: "venueCosts.error.invalidGroupTiers",
  group_tiers_must_be_open_ended: "venueCosts.error.groupTiersOpenEnded",
  duplicate_scope: "venueCosts.error.duplicateScope",
  ambiguous_scope: "venueCosts.error.ambiguousScope",
  invalid_rule: "venueCosts.error.invalidRule",
  invalid_rule_reference: "venueCosts.error.invalidRuleReference",
  draft_not_found: "venueCosts.error.draftNotFound",
  forbidden: "venueCosts.error.forbidden",
  venue_cost_save_failed: "venueCosts.error.saveFailed",
  accepted_rule_overlap: "venueCosts.error.acceptedRuleOverlap",
  venue_cost_accept_failed: "venueCosts.error.acceptFailed",
  venue_cost_delete_draft_failed: "venueCosts.error.deleteDraftFailed",
  end_date_in_past: "venueCosts.error.endDateInPast",
  end_date_before_start: "venueCosts.error.endDateBeforeStart",
  venue_cost_end_early_failed: "venueCosts.error.endEarlyFailed",
};

export function parseVenueCostDraftErrorCode(raw: string): VenueCostDraftErrorParsed {
  if (raw.startsWith("duplicate_scope:")) {
    return { code: "duplicate_scope", params: { key: raw.slice("duplicate_scope:".length) } };
  }
  if (raw.startsWith("ambiguous_scope:")) {
    const rest = raw.slice("ambiguous_scope:".length);
    const [keyA, keyB] = rest.split(":");
    return { code: "ambiguous_scope", params: { keyA: keyA ?? "", keyB: keyB ?? "" } };
  }
  return { code: raw };
}

export function venueCostDraftErrorKey(parsed: VenueCostDraftErrorParsed): I18nKey {
  return ERROR_KEY_MAP[parsed.code] ?? "venueCosts.error.saveFailed";
}

export function formatVenueCostDraftError(
  raw: string,
  translate: TranslateFn,
  fallback?: I18nKey
): string {
  const parsed = parseVenueCostDraftErrorCode(raw);
  const key = ERROR_KEY_MAP[parsed.code] ?? fallback ?? "venueCosts.error.saveFailed";
  return translate(key, parsed.params);
}

const REOPEN_LESSON_ERROR_KEY_MAP: Record<string, I18nKey> = {
  reason_required: "venueCosts.reopenLesson.errorReasonRequired",
  forbidden: "venueCosts.error.forbidden",
};

export function formatReopenLessonError(raw: string, translate: TranslateFn): string {
  const key = REOPEN_LESSON_ERROR_KEY_MAP[raw];
  if (key) return translate(key);
  return translate("venueCosts.reopenLesson.error", { error: raw });
}

export function formatVenueCostDraftErrors(
  codes: string[],
  translate: TranslateFn
): string[] {
  return codes.map((code) => formatVenueCostDraftError(code, translate));
}
