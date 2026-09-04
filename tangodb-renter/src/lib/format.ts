export function formatMoney(amount: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

export function holdCountdown(
  holdExpiresAt: string | null,
  nowMs: number = Date.now()
): string | null {
  if (!holdExpiresAt) return null;
  const ms = new Date(holdExpiresAt).getTime() - nowMs;
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function holdCountdownExpired(
  holdExpiresAt: string | null,
  nowMs: number = Date.now()
): boolean {
  if (!holdExpiresAt) return false;
  return new Date(holdExpiresAt).getTime() - nowMs <= 0;
}

export function formatHoldDeadline(
  holdExpiresAt: string | null,
  locale: string,
  timeZone?: string
): string | null {
  if (!holdExpiresAt) return null;
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
    }).format(new Date(holdExpiresAt));
  } catch {
    return null;
  }
}
