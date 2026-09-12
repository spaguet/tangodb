const TELEGRAM_TEXT_MAX = 4096;

export function developerInboxUrl(): string | null {
  const base = (Deno.env.get("DEV_CONSOLE_PUBLIC_URL") ?? "").trim().replace(/\/+$/, "");
  if (!base) return null;
  if (!/^https:\/\//i.test(base)) return null;
  return `${base}/inbox`;
}

export function appendInboxLine(text: string, inboxUrl: string | null): string {
  const body = (text ?? "").trimEnd();
  if (!inboxUrl) return body.slice(0, TELEGRAM_TEXT_MAX);
  const line = `\nInbox: ${inboxUrl}`;
  const budget = TELEGRAM_TEXT_MAX - line.length;
  if (budget <= 0) return inboxUrl.slice(0, TELEGRAM_TEXT_MAX);
  return `${body.slice(0, budget)}${line}`;
}

export function retryDelaySeconds(attempts: number, retryAfter?: number): number {
  if (typeof retryAfter === "number" && Number.isFinite(retryAfter) && retryAfter > 0) {
    const jitter = Math.floor(Math.random() * 6);
    return Math.min(3600, Math.max(15, Math.floor(retryAfter) + jitter));
  }
  const exp = 30 * 2 ** Math.min(Math.max(attempts, 0), 6);
  const jitter = Math.floor(Math.random() * 16);
  return Math.min(3600, Math.max(15, exp + jitter));
}
