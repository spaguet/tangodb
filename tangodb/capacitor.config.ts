import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.tangodb.crm",
  appName: "TangoDB",
  webDir: "dist",
  android: {
    allowMixedContent: false,
  },
  server: {
    androidScheme: "https",
    // Same host as the live CRM so Turnstile accepts the widget inside the WebView.
    // `localhost` makes the Cloudflare challenge iframe fail ("cannot connect").
    // Local files still come from the Capacitor asset server; this is not server.url.
    hostname: "tangodb.vercel.app",
  },
};

export default config;
