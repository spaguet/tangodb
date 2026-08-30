/** Telegram user id on the wire is a decimal string (not JS number). */
export function parseTelegramIdInput(
  raw: string
): { ok: true; value: string | null } | { ok: false } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };
  if (!/^[1-9][0-9]*$/.test(trimmed)) return { ok: false };
  if (trimmed.length > 20) return { ok: false };
  return { ok: true, value: trimmed };
}
