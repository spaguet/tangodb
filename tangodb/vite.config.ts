import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import { getRenterMiniappOrigin } from './src/lib/renterMiniappHandoff.ts';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      target: ["es2020", "chrome80", "safari14"],
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = new URL(req.url ?? "/", "http://localhost");
          const startParam = url.searchParams.get("tgWebAppStartParam")?.trim();
          if (!startParam) {
            next();
            return;
          }
          const target = new URL(url.pathname, `${getRenterMiniappOrigin()}/`);
          target.searchParams.set("tgWebAppStartParam", startParam);
          res.statusCode = 302;
          res.setHeader("Location", target.toString());
          res.end();
        });
      },
    },
  };
});
