import { handleOptions, jsonResponse, verifyCronSecret } from "../_shared/http.ts";
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
  const { data, error } = await admin.rpc("run_personal_lessons_calendar_reconciliation");

  if (error) {
    logEvent("gcal_reconcile_cron_error", { message: error.message });
    return jsonResponse({ error: "Reconciliation job failed" }, 500, req);
  }

  logEvent("gcal_reconcile_cron_complete", {
    result: data,
  });

  return jsonResponse({ ok: true, ...(data as Record<string, unknown>) }, 200, req);
});
