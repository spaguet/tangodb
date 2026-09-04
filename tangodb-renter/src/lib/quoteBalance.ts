import type { WalletData } from "./types";

/** FIFO-available balance for quote UI (§1.6: zero while debt outstanding). */
export function quoteAvailable(wallet: Pick<WalletData, "spendable" | "debt_amount">): number {
  if (wallet.debt_amount > 0) return 0;
  return Math.max(0, wallet.spendable);
}

export function quoteShortage(requiredPrepay: number, available: number): number {
  return Math.max(0, requiredPrepay - available);
}

/** Suggested top-up: clears debt first, then covers activation prepay. */
export function topupSuggestAmount(
  wallet: Pick<WalletData, "spendable" | "debt_amount">,
  requiredPrepay: number
): number {
  if (wallet.debt_amount > 0) {
    return wallet.debt_amount + requiredPrepay;
  }
  return quoteShortage(requiredPrepay, quoteAvailable(wallet));
}

export function formatTopupAmount(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return "";
  const rounded = Math.round(amount * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}
