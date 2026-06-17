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
  const { data, error } = await admin.rpc("run_demo_lifecycle");

  if (error) {
    logEvent("demo_lifecycle_error", { message: error.message });
    return jsonResponse({ error: "Lifecycle job failed" }, 500, req);
  }

  logEvent("demo_lifecycle_complete", {
    transitioned: Number((data as Record<string, unknown>)?.transitioned_to_retention ?? 0),
  });

  return jsonResponse({ ok: true, ...(data as Record<string, unknown>) }, 200, req);
});
