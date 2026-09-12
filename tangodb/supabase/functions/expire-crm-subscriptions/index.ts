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
  const { data, error } = await admin.rpc("expire_crm_organization_subscriptions");

  if (error) {
    logEvent("expire_crm_subscriptions_error", { message: error.message });
    return jsonResponse({ error: "Expire job failed" }, 500, req);
  }

  logEvent("expire_crm_subscriptions_complete", {
    past_due: Number((data as Record<string, unknown>)?.past_due_count ?? 0),
    suspended: Number((data as Record<string, unknown>)?.suspended_count ?? 0),
  });

  return jsonResponse({ ok: true, ...(data as Record<string, unknown>) }, 200, req);
});
