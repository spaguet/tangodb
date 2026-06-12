export interface TelegramWebAppUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface TelegramLoginWidgetPayload {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        initDataUnsafe?: { user?: TelegramWebAppUser };
        platform: string;
        ready: () => void;
        expand: () => void;
        openTelegramLink?: (url: string) => void;
        openLink?: (url: string) => void;
      };
    };
  }
}

/** Normalize stored contact value to an absolute Telegram chat URL. */
export function normalizeTelegramContact(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^https?:\/\/t\.me\//i.test(trimmed)) return trimmed;
  if (/^t\.me\//i.test(trimmed)) return `https://${trimmed}`;
  if (/^tg:\/\//i.test(trimmed)) return trimmed;

  const withoutAt = trimmed.replace(/^@/, "");
  if (/^\d+$/.test(withoutAt)) return `tg://user?id=${withoutAt}`;
  if (/^[a-zA-Z0-9_]{5,}$/.test(withoutAt)) return `https://t.me/${withoutAt}`;

  return null;
}

/** Open a direct Telegram chat; uses Mini App API when available. */
export function openTelegramContact(value: string): void {
  const url = normalizeTelegramContact(value);
  if (!url) return;

  const webApp = window.Telegram?.WebApp;
  if (webApp?.openTelegramLink && url.startsWith("https://t.me/")) {
    webApp.openTelegramLink(url);
    return;
  }
  if (webApp?.openLink) {
    webApp.openLink(url);
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

/** Canonical value for DB storage (username → https://t.me/…, numeric id kept as digits). */
export function normalizeTelegramForStorage(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const url = normalizeTelegramContact(trimmed);
  if (!url) return trimmed;
  if (url.startsWith("https://t.me/")) return url;
  if (url.startsWith("tg://user?id=")) return url.slice("tg://user?id=".length);
  return trimmed;
}

export function formatTelegramDisplay(value: string): string {
  const url = normalizeTelegramContact(value);
  if (!url) return value;
  if (url.startsWith("https://t.me/")) return `@${url.slice("https://t.me/".length)}`;
  if (url.startsWith("tg://user?id=")) return url.slice("tg://user?id=".length);
  return value;
}

/** True when opened inside the Telegram client (Mini App). */
export function isInsideTelegramClient(): boolean {
  if (typeof window === "undefined") return false;
  const webApp = window.Telegram?.WebApp;
  return Boolean(webApp && webApp.platform !== "unknown");
}

/** True when Telegram passed initData for server-side auth. */
export function isTelegramWebApp(): boolean {
  if (typeof window === "undefined") return false;
  const initData = window.Telegram?.WebApp?.initData;
  return Boolean(initData && initData.length > 0);
}

export function getTelegramInitData(): string | null {
  const initData = window.Telegram?.WebApp?.initData;
  return initData && initData.length > 0 ? initData : null;
}

export function initTelegramWebApp(): void {
  const webApp = window.Telegram?.WebApp;
  if (!webApp) return;
  webApp.ready();
  webApp.expand();
}
