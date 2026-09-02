const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getRawInitData(): string {
  return (window.Telegram?.WebApp?.initData ?? "").trim();
}

/** telegram-web-app.js can populate initData a tick after the module graph runs. */
export async function waitForTelegramInitData(timeoutMs = 2000): Promise<string> {
  const started = Date.now();
  let raw = getRawInitData();
  if (raw) return raw;
  while (Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    raw = getRawInitData();
    if (raw) return raw;
  }
  return getRawInitData();
}

export function parseStartParamFromInitData(initData: string): string | null {
  if (!initData) return null;
  const value = new URLSearchParams(initData).get("start_param")?.trim() ?? "";
  if (!value || !UUID_RE.test(value)) return null;
  return value;
}

export function parseTelegramLanguage(initData: string): string | null {
  if (!initData) return null;
  const rawUser = new URLSearchParams(initData).get("user");
  if (!rawUser) return null;
  try {
    const user = JSON.parse(rawUser) as { language_code?: string };
    return user.language_code ?? null;
  } catch {
    return null;
  }
}

export function renterAuthStorageKey(organizationId: string): string {
  return `tangodb-renter-auth-${organizationId}`;
}
