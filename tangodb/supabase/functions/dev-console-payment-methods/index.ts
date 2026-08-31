import { isDeveloper } from "../_shared/devAuth.ts";
import {
  getClientIp,
  handleOptions,
  jsonResponse,
} from "../_shared/http.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createServiceClient, createUserClient, logEvent } from "../_shared/supabase.ts";

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 15 * 60_000;

function sanitizeConfig(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  return raw as Record<string, unknown>;
}

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
  if (!(await checkRateLimit(`dev-console-payment:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS))) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const userClient = createUserClient(authHeader);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user || !isDeveloper(userData.user, authHeader)) {
    return jsonResponse({ error: "developer_access_required" }, 403, req);
  }

  let body: { action?: string; config?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, req);
  }

  const action = body.action === "update" ? "update" : "get";
  const admin = createServiceClient();

  if (action === "get") {
    const { data, error } = await admin
      .from("platform_payment_methods")
      .select("config, updated_at")
      .eq("id", 1)
      .maybeSingle();

    if (error) {
      logEvent("dev_console_payment_get_error", { code: error.code ?? "unknown" });
      return jsonResponse({ error: "Load failed" }, 500, req);
    }

    return jsonResponse(
      {
        ok: true,
        config: data?.config ?? {},
        updated_at: data?.updated_at ?? null,
      },
      200,
      req
    );
  }

  const config = sanitizeConfig(body.config);
  const { data: row, error: updateError } = await admin
    .from("platform_payment_methods")
    .upsert(
      {
        id: 1,
        config,
        updated_at: new Date().toISOString(),
        updated_by: userData.user.id,
      },
      { onConflict: "id" }
    )
    .select("config, updated_at")
    .single();

  if (updateError) {
    logEvent("dev_console_payment_update_error", { code: updateError.code ?? "unknown" });
    return jsonResponse({ error: "Update failed" }, 500, req);
  }

  await admin.from("platform_audit_log").insert({
    actor_user_id: userData.user.id,
    action: "payment_config.update",
    target_type: "platform_payment_methods",
    target_id: "1",
    metadata: {
      has_crypto: Array.isArray(config.crypto) ? config.crypto.length : 0,
      has_bank: Boolean(config.bankTransfer),
      has_vietnamese_bank: Boolean(config.vietnameseBankTransfer),
      has_mir: Boolean(config.mir),
      has_contacts: Boolean(config.contacts),
      has_miniapp_addon_price: Boolean(
        config.renterMiniappAddon &&
          typeof config.renterMiniappAddon === "object" &&
          !Array.isArray(config.renterMiniappAddon) &&
          Boolean((config.renterMiniappAddon as { amount?: unknown }).amount)
      ),
    },
  });

  return jsonResponse(
    {
      ok: true,
      config: row.config,
      updated_at: row.updated_at,
    },
    200,
    req
  );
});
