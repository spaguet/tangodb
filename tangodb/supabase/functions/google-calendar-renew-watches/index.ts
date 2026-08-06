import { handleOptions, jsonResponse, verifyCronSecret } from "../_shared/http.ts";
import {
  GoogleCalendarApiError,
  loadGoogleOAuthConfigOrThrow,
} from "../_shared/googleCalendarClient.ts";
import { renewExpiringWatchChannels } from "../_shared/googleCalendarWatch.ts";
import { createServiceClient, logEvent } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, req);
  }

  if (!verifyCronSecret(req)) {
    return jsonResponse({ error: "Unauthorized" }, 401, req);
  }

  const admin = createServiceClient();
  let oauthConfig;
  try {
    oauthConfig = await loadGoogleOAuthConfigOrThrow();
  } catch (err) {
    const message = err instanceof GoogleCalendarApiError ? err.message : "oauth_not_configured";
    logEvent("gcal_renew_watches_config_error", { message });
    return jsonResponse({ error: "Service unavailable" }, 503, req);
  }

  try {
    const result = await renewExpiringWatchChannels(admin, oauthConfig);
    logEvent("gcal_renew_watches_complete", result);
    return jsonResponse({ ok: true, ...result }, 200, req);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    logEvent("gcal_renew_watches_error", { message });
    return jsonResponse({ error: "Renew failed" }, 500, req);
  }
});
