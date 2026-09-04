import type { WalletData } from "./types";

/** Poll interval while a pending top-up or awaiting_payment hold needs live updates. */
export const CABINET_POLL_MS = 15_000;

export function needsCabinetPolling(
  wallet: Pick<WalletData, "pending_topup" | "has_awaiting_payment"> | null
): boolean {
  if (!wallet) return false;
  return Boolean(wallet.pending_topup) || Boolean(wallet.has_awaiting_payment);
}

export function formatRequestAge(createdAt: string, locale: string): string {
  const ms = Date.now() - new Date(createdAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) {
    return locale.startsWith("en") ? "just now" : "только что";
  }
  if (minutes < 60) {
    return locale.startsWith("en") ? `${minutes} min ago` : `${minutes} мин назад`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return locale.startsWith("en") ? `${hours} h ago` : `${hours} ч назад`;
  }
  const days = Math.floor(hours / 24);
  return locale.startsWith("en") ? `${days} d ago` : `${days} дн назад`;
}
