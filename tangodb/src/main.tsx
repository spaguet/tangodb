import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { assertReceptionPermissions } from "./lib/permissions.ts";
import "./index.css";

if (import.meta.env.DEV) {
  assertReceptionPermissions();
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
