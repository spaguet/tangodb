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
      };
    };
  }
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
