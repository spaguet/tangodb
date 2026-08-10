import type { I18nKey } from "./i18n/keys";

/** Map internal venue-cost accrual reason codes to i18n keys. */
export function venueCostAccrualReasonKey(reason: string | null | undefined): I18nKey | null {
  const raw = reason?.trim();
  if (!raw) return null;
  if (raw === "correction_after_rule_accept") return "venueCosts.finance.reason.correctionAfterRuleAccept";
  if (raw.startsWith("corrected_zero_accrual:")) return "venueCosts.finance.reason.correctedZeroAccrual";
  if (raw.startsWith("resolved_by_rule:")) return "venueCosts.finance.reason.resolvedByRule";
  return null;
}

export function formatVenueCostAccrualReason(
  reason: string | null | undefined,
  t: (key: I18nKey) => string
): string | null {
  const key = venueCostAccrualReasonKey(reason);
  if (key) return t(key);
  return reason?.trim() || null;
}
