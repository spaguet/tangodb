import { isDeveloperVerified } from "../_shared/devAuth.ts";
import { getClientIp, handleOptions, jsonResponse } from "../_shared/http.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createServiceClient, createUserClient, logEvent } from "../_shared/supabase.ts";

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 15 * 60_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, req);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Unauthorized" }, 401, req);
  }

  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`dev-console-flags:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS))) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const userClient = createUserClient(authHeader);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user || !(await isDeveloperVerified(userData.user))) {
    return jsonResponse({ error: "developer_access_required" }, 403, req);
  }

  let body: { action?: string; enabled?: boolean; note?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const action = (body.action ?? "get").trim();
  const admin = createServiceClient();

  if (action === "get") {
    const { data: row, error } = await admin
      .from("platform_runtime_flags")
      .select("value, updated_at, updated_by")
      .eq("key", "editions_lifecycle")
      .maybeSingle();

    if (error) {
      logEvent("dev_console_flags_get_error", { message: error.message });
      return jsonResponse({ error: "Load failed" }, 500, req);
    }

    const value = (row?.value ?? { enabled: false }) as { enabled?: boolean };
    return jsonResponse(
      {
        ok: true,
        editions_lifecycle: {
          enabled: value.enabled === true,
          updated_at: row?.updated_at ?? null,
          updated_by: row?.updated_by ?? null,
        },
      },
      200,
      req
    );
  }

  if (action === "set") {
    const note = (body.note ?? "").trim().slice(0, 500);
    if (!note) {
      return jsonResponse({ error: "note_required" }, 400, req);
    }

    const { data: result, error: setError } = await admin.rpc("dev_console_set_editions_lifecycle", {
      p_enabled: body.enabled === true,
      p_actor_id: userData.user.id,
      p_note: note,
    });

    if (setError) {
      logEvent("dev_console_flags_set_error", { message: setError.message });
      return jsonResponse({ error: "Set failed" }, 500, req);
    }

    return jsonResponse({ ok: true, ...(result as Record<string, unknown>) }, 200, req);
  }

  return jsonResponse({ error: "invalid_action" }, 400, req);
});
