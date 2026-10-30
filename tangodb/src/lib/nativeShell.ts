import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { isNativeCrmShell } from "./platform";

const IN_APP_HOSTS = new Set(["localhost", "127.0.0.1"]);

const EXTERNAL_PATH_PREFIXES = [
  "/auth/forgot-password",
  "/auth/reset-password",
  "/auth/verify-email",
  "/accept-invite",
];

const handlers = {
  navigateBack: () => {},
  onRootBack: () => {},
};

function shouldOpenExternally(url: URL): boolean {
  if (url.protocol !== "http:" && url.protocol !== "https:") return true;
  if (!IN_APP_HOSTS.has(url.hostname)) return true;
  return EXTERNAL_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

function setupExternalLinkGuard() {
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;

      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }

      if (!shouldOpenExternally(url)) return;

      event.preventDefault();
      void Browser.open({ url: url.toString() });
    },
    true
  );
}

let listenerRegistered = false;

export function bindNativeShellHandlers(options: {
  navigateBack: () => void;
  onRootBack: () => void;
}): void {
  if (!isNativeCrmShell()) return;
  handlers.navigateBack = options.navigateBack;
  handlers.onRootBack = options.onRootBack;

  if (listenerRegistered) return;
  listenerRegistered = true;
  setupExternalLinkGuard();
  void App.addListener("backButton", ({ canGoBack }) => {
    if (canGoBack) {
      handlers.navigateBack();
      return;
    }
    handlers.onRootBack();
  });
}
