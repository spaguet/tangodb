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

window.addEventListener("error", showBootError);
window.addEventListener("unhandledrejection", showBootError);

try {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
} catch {
  showBootError();
}
