import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { assertReceptionPermissions, assertPayrollPermissions } from "./lib/permissions.ts";
import "./index.css";

if (import.meta.env.DEV) {
  assertReceptionPermissions();
  assertPayrollPermissions();
}

function showBootError() {
  const el = document.getElementById("boot-error");
  if (el) el.classList.add("visible");
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
