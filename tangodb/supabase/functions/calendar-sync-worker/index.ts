import { handleOptions, jsonResponse, verifyCronSecret } from "../_shared/http.ts";
import {
  DEFAULT_WORKER_BATCH_SIZE,
  runCalendarSyncBatches,
  WORKER_TIME_BUDGET_MS,
} from "../_shared/calendarSyncRunner.ts";
import {
  GoogleCalendarApiError,
  loadGoogleOAuthConfigOrThrow,
} from "../_shared/googleCalendarClient.ts";
import { createServiceClient, logEvent } from "../_shared/supabase.ts";

function workerId(): string {
  return `calendar-sync-worker-${crypto.randomUUID()}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, req);
  }

  if (!verifyCronSecret(req)) {
    return jsonResponse({ error: "Unauthorized" }, 401, req);
  }

  let batchSize = DEFAULT_WORKER_BATCH_SIZE;
  try {
    const body = await req.json().catch(() => ({})) as { batch_size?: number };
    if (typeof body.batch_size === "number" && body.batch_size >= 1 && body.batch_size <= 100) {
      batchSize = Math.floor(body.batch_size);
    }
  } catch {
    // use default batch size
  }

  const admin = createServiceClient();
  let oauthConfig;
  try {
    oauthConfig = await loadGoogleOAuthConfigOrThrow();
  } catch (err) {
    const message = err instanceof GoogleCalendarApiError ? err.message : "oauth_not_configured";
    logEvent("gcal_worker_config_error", { message });
    return jsonResponse({ error: "Service unavailable" }, 503, req);
  }

  const runId = workerId();
  try {
    const result = await runCalendarSyncBatches(admin, oauthConfig, {
      batchSize,
      timeBudgetMs: WORKER_TIME_BUDGET_MS,
      workerId: runId,
      chainIfNeeded: true,
    });

    return jsonResponse(
      {
        ok: true,
        worker_id: runId,
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
    if (message === "Claim failed") {
      return jsonResponse({ error: "Claim failed" }, 500, req);
    }
    throw err;
  }
});
