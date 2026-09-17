import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { assertReceptionPermissions, assertPayrollPermissions } from "./lib/permissions.ts";
import "./index.css";

if (import.meta.env.DEV) {
  assertReceptionPermissions();
  assertPayrollPermissions();
}

function isTelegramMiniAppBootContext(): boolean {
  const initData = window.Telegram?.WebApp?.initData;
  return typeof initData === "string" && initData.length > 0;
}

function showBootError() {
  if (document.getElementById("boot-error")) return;

  const el = document.createElement("div");
  el.id = "boot-error";
  el.setAttribute("role", "alert");
  el.style.cssText =
    "min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;font-family:system-ui,sans-serif;color:#334155;background:#f8fafc;text-align:center";

  const title = document.createElement("p");
  title.style.cssText = "font-weight:600;margin-bottom:8px";
  title.textContent = "Не удалось загрузить TangoDB";

  const hint = document.createElement("p");
  hint.style.cssText = "font-size:14px;color:#64748b;margin:0";
  hint.textContent = isTelegramMiniAppBootContext()
    ? "Обновите страницу или откройте приложение заново из Telegram."
    : "Обновите страницу. Если ошибка повторяется — проверьте подключение к интернету.";

  const inner = document.createElement("div");
  inner.append(title, hint);
  el.append(inner);
  document.body.prepend(el);
}

function clearBootErrorShell() {
  document.getElementById("boot-error")?.remove();
}

function bootCrm() {
  let appMounted = false;

  // Only fatal script/chunk load failures should hide the whole shell.
  window.addEventListener("error", (event) => {
    const target = event.target;
    if (target instanceof HTMLScriptElement || target instanceof HTMLLinkElement) {
      showBootError();
    }
  });

  try {
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <App />
      </StrictMode>
    );
    appMounted = true;
    clearBootErrorShell();
  } catch {
    showBootError();
  }

  if (import.meta.env.DEV) {
    window.addEventListener("unhandledrejection", (event) => {
      if (!appMounted) showBootError();
      console.error("[TangoDB] Unhandled rejection", event.reason);
    });
  }
}

bootCrm();
