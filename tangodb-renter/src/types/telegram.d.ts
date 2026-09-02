export interface TelegramWebAppUser {
  id: number;
  language_code?: string;
}

export interface TelegramWebApp {
  initData: string;
  ready: () => void;
  expand: () => void;
  requestWriteAccess?: (callback?: (granted: boolean) => void) => void;
  openTelegramLink?: (url: string) => void;
  openLink?: (url: string) => void;
  downloadFile?: (
    params: { url: string; file_name: string },
    callback?: (status: "downloading" | "cancelled" | "failed" | "success") => void
  ) => void;
  onEvent?: (eventType: string, callback: () => void) => void;
  offEvent?: (eventType: string, callback: () => void) => void;
  colorScheme: "light" | "dark";
  themeParams: Record<string, string | undefined>;
}

export interface TelegramNamespace {
  WebApp: TelegramWebApp;
}

declare global {
  interface Window {
    Telegram?: TelegramNamespace;
  }
}

export {};
