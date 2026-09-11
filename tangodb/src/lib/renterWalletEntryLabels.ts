import type { I18nKey } from "./i18n/keys";

const walletEntryLabelKey: Record<string, I18nKey> = {
  topup: "renters.detail.walletEntry.topup",
  topup_reversal: "renters.detail.walletEntry.topupReversal",
  prepay_charge: "renters.detail.walletEntry.prepayCharge",
  remainder_charge: "renters.detail.walletEntry.remainderCharge",
  refund: "renters.detail.walletEntry.refund",
  debt_settle: "renters.detail.walletEntry.debtSettle",
  surcharge_one_time_recalc: "renters.detail.walletEntry.surchargeOneTimeRecalc",
  wallet_payout: "renters.detail.walletEntry.walletPayout",
  wallet_correction_credit: "renters.detail.walletEntry.walletCorrectionCredit",
  wallet_correction_debit: "renters.detail.walletEntry.walletCorrectionDebit",
};

const walletOutflowTypes = new Set([
  "topup_reversal",
  "wallet_payout",
  "wallet_correction_debit",
]);

export function getWalletEntryLabel(
  entryType: string,
  t: (key: I18nKey, vars?: Record<string, string | number>) => string
): string {
  const normalized = entryType.trim();
  const key = walletEntryLabelKey[normalized];
  return key ? t(key) : normalized;
}

export function isWalletLedgerDebit(entryType: string): boolean {
  return walletOutflowTypes.has(entryType);
}
