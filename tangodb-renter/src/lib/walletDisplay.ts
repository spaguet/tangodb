import type { WalletEntry } from "./types";

export type WalletEntryMessageKey =
  | "walletEntryTopup"
  | "walletEntryTopupReversal"
  | "walletEntryPrepayCharge"
  | "walletEntryRemainderCharge"
  | "walletEntryRefund"
  | "walletEntryDebtSettle"
  | "walletEntrySurcharge";

const entryLabelKey: Record<string, WalletEntryMessageKey> = {
  topup: "walletEntryTopup",
  topup_reversal: "walletEntryTopupReversal",
  prepay_charge: "walletEntryPrepayCharge",
  remainder_charge: "walletEntryRemainderCharge",
  refund: "walletEntryRefund",
  debt_settle: "walletEntryDebtSettle",
  surcharge_one_time_recalc: "walletEntrySurcharge",
};

export function walletEntryLabelKey(entryType: string): WalletEntryMessageKey | null {
  return entryLabelKey[entryType] ?? null;
}

export function walletEntryIsCredit(entry: Pick<WalletEntry, "direction" | "entry_type">): boolean {
  if (entry.direction === "credit") return true;
  if (entry.direction === "debit") return false;
  return entry.entry_type === "topup" || entry.entry_type === "refund";
}

export function walletEntryAmountClass(entry: Pick<WalletEntry, "direction" | "entry_type">): string {
  return walletEntryIsCredit(entry) ? "text-green-700" : "text-rose-600";
}

export function walletEntryAmountPrefix(entry: Pick<WalletEntry, "direction" | "entry_type">): string {
  return walletEntryIsCredit(entry) ? "+" : "−";
}
