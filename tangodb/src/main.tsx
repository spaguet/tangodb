import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { assertReceptionPermissions, assertPayrollPermissions } from "./lib/permissions.ts";
import "./index.css";

if (import.meta.env.DEV) {
  assertReceptionPermissions();
  assertPayrollPermissions();
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
