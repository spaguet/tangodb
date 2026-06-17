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
  const { data, error } = await admin.rpc("purge_expired_demo_organizations");

  if (error) {
    logEvent("purge_demo_orgs_error", { message: error.message });
    return jsonResponse({ error: "Purge job failed" }, 500, req);
  }

  logEvent("purge_demo_orgs_complete", {
    purged: Number((data as Record<string, unknown>)?.purged_count ?? 0),
  });

  return jsonResponse({ ok: true, ...(data as Record<string, unknown>) }, 200, req);
});
