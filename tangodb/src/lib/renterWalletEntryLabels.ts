import type { I18nKey } from "./i18n/keys";

const walletEntryLabelKey: Record<string, I18nKey> = {
  topup: "renters.detail.walletEntry.topup",
  topup_reversal: "renters.detail.walletEntry.topupReversal",
  prepay_charge: "renters.detail.walletEntry.prepayCharge",
  remainder_charge: "renters.detail.walletEntry.remainderCharge",
  refund: "renters.detail.walletEntry.refund",
  debt_settle: "renters.detail.walletEntry.debtSettle",
  surcharge_one_time_recalc: "renters.detail.walletEntry.surchargeOneTimeRecalc",
};

export function getWalletEntryLabel(
  entryType: string,
  t: (key: I18nKey, vars?: Record<string, string | number>) => string
): string {
  const normalized = entryType.trim();
  const key = walletEntryLabelKey[normalized];
  return key ? t(key) : normalized;
}
