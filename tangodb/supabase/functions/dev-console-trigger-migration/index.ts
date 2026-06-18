import { isDeveloper } from "../_shared/devAuth.ts";
import {
  getClientIp,
  handleOptions,
  jsonResponse,
} from "../_shared/http.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createServiceClient, createUserClient, logEvent } from "../_shared/supabase.ts";

const RATE_LIMIT = 10;
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
  if (!checkRateLimit(`dev-console-trigger-migration:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const userClient = createUserClient(authHeader);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user || !isDeveloper(userData.user)) {
    return jsonResponse({ error: "Forbidden" }, 403, req);
  }

  let body: { organization_id?: string; target_version_id?: string; dry_run?: boolean };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400, req);
  }

  const organizationId = body.organization_id?.trim();
  const targetVersionId = body.target_version_id?.trim();
  const dryRun = body.dry_run === true;

  if (!organizationId || !targetVersionId) {
    return jsonResponse({ error: "organization_id and target_version_id required" }, 400, req);
  }

  const admin = createServiceClient();
  const { data, error } = await admin.rpc("migrate_organization_version", {
    p_organization_id: organizationId,
    p_target_version_id: targetVersionId,
    p_dry_run: dryRun,
    p_actor_user_id: userData.user.id,
  });

  if (error) {
    logEvent("dev_console_trigger_migration_error", {
      code: error.code ?? "unknown",
      org_id: organizationId,
    });
    return jsonResponse(
      { error: error.message ?? "Migration failed" },
      400,
      req
    );
  }

  logEvent("dev_console_trigger_migration", {
    org_id: organizationId,
    dry_run: dryRun,
    migration_id: typeof data === "object" && data && "migration_id" in data
      ? String((data as { migration_id: string }).migration_id)
      : null,
  });

  return jsonResponse({ ok: true, result: data }, 200, req);
});
