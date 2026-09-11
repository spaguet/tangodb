import type { WalletData } from "./types";

/** FIFO-available balance for quote UI (§1.6: zero while debt outstanding). */
export function quoteAvailable(wallet: Pick<WalletData, "spendable" | "debt_amount">): number {
  if (wallet.debt_amount > 0) return 0;
  return Math.max(0, wallet.spendable);
}

export function quoteShortage(requiredCoverage: number, available: number): number {
  return Math.max(0, requiredCoverage - available);
}

/** Full rental cost for Mini App top-up (100%, not the 50% activation prepay). */
export function rentalQuoteCoverage(params: {
  cost?: number | null;
  fixedAmount?: number | null;
  prepay?: number | null;
  remainder?: number | null;
}): number {
  const fixed = params.fixedAmount ?? 0;
  if (fixed > 0) return fixed;
  const cost = params.cost ?? 0;
  if (cost > 0) return cost;
  return Math.max(0, (params.prepay ?? 0) + (params.remainder ?? 0));
}

/**
 * Suggested top-up: outstanding debt + 100% of this rental, minus spendable when there is no debt.
 * Activation on the server still reserves 50%; the extra 50% stays spendable for the time_end remainder.
 */
export function topupSuggestAmount(
  wallet: Pick<WalletData, "spendable" | "debt_amount">,
  requiredCoverage: number
): number {
  const coverage = Math.max(0, requiredCoverage);
  const debt = Math.max(0, wallet.debt_amount);
  if (debt > 0) {
    return debt + coverage;
  }
  return quoteShortage(coverage, quoteAvailable(wallet));
}

export function suggestedTopupAmount(
  requiredCoverage: number,
  wallet: Pick<WalletData, "spendable" | "debt_amount"> | null | undefined
): number {
  const coverage = Math.max(0, requiredCoverage);
  if (!wallet) return coverage;
  return topupSuggestAmount(wallet, coverage);
}

export function formatTopupAmount(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return "";
  const rounded = Math.round(amount * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}
