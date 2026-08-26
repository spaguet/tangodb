import {
  getClientIp,
  handleOptions,
  jsonResponse,
} from "../_shared/http.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import {
  KICK_BATCH_SIZE,
  KICK_TIME_BUDGET_MS,
  runCalendarSyncBatches,
} from "../_shared/calendarSyncRunner.ts";
import {
  GoogleCalendarApiError,
  loadGoogleOAuthConfigOrThrow,
} from "../_shared/googleCalendarClient.ts";
import { createServiceClient, createUserClient, logEvent } from "../_shared/supabase.ts";

const RATE_LIMIT = 40;
const RATE_WINDOW_MS = 15 * 60_000;

type KickBody = {
  organization_id?: string;
};

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
  if (!checkRateLimit(`gcal-sync-kick:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const userClient = createUserClient(authHeader);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return jsonResponse({ error: "Unauthorized" }, 401, req);
  }

  let body: KickBody = {};
  try {
    body = await req.json() as KickBody;
  } catch {
    body = {};
  }

  const organizationId = (body.organization_id ?? "").trim();
  if (!organizationId) {
    return jsonResponse({ error: "organization_id required" }, 400, req);
  }

  const admin = createServiceClient();
  const { data: member } = await admin
    .from("organization_members")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", userData.user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (!member) {
    return jsonResponse({ error: "Forbidden" }, 403, req);
  }

  let oauthConfig;
  try {
    oauthConfig = await loadGoogleOAuthConfigOrThrow();
  } catch (err) {
    const message = err instanceof GoogleCalendarApiError ? err.message : "oauth_not_configured";
    logEvent("gcal_kick_config_error", { message, organization_id: organizationId });
    return jsonResponse({ error: "Service unavailable" }, 503, req);
  }

  try {
    const result = await runCalendarSyncBatches(admin, oauthConfig, {
      batchSize: KICK_BATCH_SIZE,
      timeBudgetMs: KICK_TIME_BUDGET_MS,
      workerId: `calendar-sync-kick-${crypto.randomUUID()}`,
      organizationId,
      chainIfNeeded: true,
    });

    return jsonResponse(
      {
        ok: true,
        claimed: result.claimed,
        processed: result.processed,
        failed: result.failed,
        batches: result.batches,
        should_continue: result.shouldContinue,
      },
      200,
      req
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    logEvent("gcal_kick_error", { organization_id: organizationId, message });
    if (message === "Claim failed") {
      return jsonResponse({ error: "Claim failed" }, 500, req);
    }
    return jsonResponse({ error: "Sync kick failed" }, 500, req);
  }
});
