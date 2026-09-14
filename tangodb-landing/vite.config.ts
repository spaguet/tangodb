import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const landingRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@crm-app-version": path.resolve(landingRoot, "../tangodb/src/lib/appVersion.ts"),
    },
  },
  plugins: [react(), tailwindcss()],
  build: {
    target: ["es2020", "chrome80", "safari14"],
  },
});
