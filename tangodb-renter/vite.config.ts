import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { proxyStudioQrRequest } from "./src/lib/qrProxy";

function qrFileDevPlugin(): Plugin {
  return {
    name: "qr-file-proxy",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = req.url ?? "";
        if (!path.startsWith("/api/qr-file")) {
          next();
          return;
        }
        try {
          const response = await proxyStudioQrRequest(
            new Request(`http://127.0.0.1${path}`, { method: req.method ?? "GET" })
          );
          res.statusCode = response.status;
          response.headers.forEach((value, key) => {
            res.setHeader(key, value);
          });
          if ((req.method ?? "GET").toUpperCase() === "HEAD") {
            res.end();
            return;
          }
          res.end(new Uint8Array(await response.arrayBuffer()));
        } catch {
          res.statusCode = 500;
          res.end("Error");
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), qrFileDevPlugin()],
  build: { outDir: "dist" },
});
